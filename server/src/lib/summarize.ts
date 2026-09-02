import "./env.js";
import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";
import { z } from "zod";
import {
  prepareForModel,
  UNAVAILABLE_SUMMARY,
  verifySummary,
} from "./redact.js";
import {
  ALLOWED_TAGS,
  FileSummarySchema,
  OverviewSchema,
  type FileSummary,
  type RepoOverview,
} from "shared";

const SYSTEM_PROMPT = `You are a senior engineer writing onboarding notes for a new team member.

You will be given the path and contents of one source file. Describe what the file does and why it exists, so a new engineer understands its role without reading it.

ABSOLUTE RULES — breaking any of these makes your answer unusable:
- Never reproduce code. Not a line, not a fragment, not an expression.
- Never quote string literals, URLs, table names, prompt text, or configuration values.
- Never invent behaviour you cannot see in the file.
- Do not mention that content was redacted or omitted.
- Write in plain prose a non-author can follow. No markdown, no bullet points, no backticks.

Respond with a single JSON object and nothing else:
{
  "role": "3-6 word label for this file's job, e.g. 'AI agent orchestrator'",
  "summary": "3-5 sentences. What it does, why it exists, and how it fits the wider system.",
  "key_exports": ["names of the main exported functions, classes or components — names only"],
  "tags": ["choose from: ai, api, ui, data, config, auth, test, build, docs, util, model, worker"]
}`;

const PROMPT_FILE_VARIANT = `This file contains LLM prompt text which has been removed before you received it. Describe what the prompt is FOR — which feature uses it, what it asks the model to produce, what inputs it takes. Never speculate about or reconstruct its wording.`;

const RETRY_INSTRUCTION =
  "Your previous answer quoted the source. Describe only purpose and behaviour, in plain prose.";

const FILE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string" },
    summary: { type: "string" },
    key_exports: { type: "array", items: { type: "string" } },
    tags: {
      type: "array",
      items: {
        type: "string",
        enum: [...ALLOWED_TAGS],
      },
    },
  },
  required: ["role", "summary", "key_exports", "tags"],
  propertyOrdering: ["role", "summary", "key_exports", "tags"],
};

const GLOSS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    gloss: { type: "string" },
  },
  required: ["gloss"],
};

const FolderGlossSchema = z.object({
  gloss: z.string(),
});

const GLOSS_SYSTEM =
  "You name what a folder in a codebase is for, based on the roles of the files inside it. Reply with one sentence, 40-100 characters, starting with a verb, describing what this folder does. Be specific to these files - never generic. Do not mention formatting, prose, markdown, or these instructions. Do not use quotes or colons.";

const GLOSS_BANNED = /[<>={}:"]/;
const GLOSS_GENERIC_PREFIX = /^(plain|prose|text|string|markdown|json)/i;

const OVERVIEW_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    what_it_is: { type: "string" },
    stack: { type: "array", items: { type: "string" } },
    entry_points: { type: "array", items: { type: "string" } },
    how_it_works: { type: "string" },
    start_here: { type: "array", items: { type: "string" } },
  },
  required: ["what_it_is", "stack", "entry_points", "how_it_works", "start_here"],
  propertyOrdering: ["what_it_is", "stack", "entry_points", "how_it_works", "start_here"],
};

export type { FileSummary };

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export function modelName(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

function overviewModelName(): string {
  return process.env.GEMINI_MODEL_OVERVIEW ?? process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
}

function concurrency(): number {
  const n = Number(process.env.CONCURRENCY ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isRetryable(err: unknown): boolean {
  if (!isRecord(err)) return false;
  const nested = isRecord(err.error) ? err.error : null;
  const codes = [err.status, err.statusCode, err.code, nested?.code, nested?.status];
  for (const code of codes) {
    const n = typeof code === "string" ? Number(code) : code;
    if (n === 429 || n === 503) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|Too Many Requests/i.test(msg);
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === 5) throw err;
      const delay = 1000 * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  throw last;
}

type GenerateOpts = {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  responseSchema?: Record<string, unknown>;
  thinkingBudget?: number;
};

async function generate(opts: GenerateOpts): Promise<string> {
  const res = await withBackoff(() =>
    getClient().models.generateContent({
      model: opts.model,
      contents: opts.user,
      config: {
        systemInstruction: opts.system,
        temperature: 0.2,
        maxOutputTokens: opts.maxOutputTokens,
        ...(opts.responseSchema
          ? {
              responseMimeType: "application/json" as const,
              responseSchema: opts.responseSchema,
            }
          : {}),
        ...(opts.thinkingBudget === undefined
          ? {}
          : { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }),
      },
    }),
  );
  const text = res.text;
  if (!text) throw new Error("Empty model response");
  return text;
}

function parseFileSummary(raw: string): FileSummary {
  const parsed = FileSummarySchema.parse(JSON.parse(raw) as unknown);
  return {
    ...parsed,
    key_exports: parsed.key_exports.map((name) => name.trim()).filter(Boolean),
  };
}

function userPayload(args: {
  owner: string;
  name: string;
  path: string;
  language: string | null;
  content: string;
}): string {
  return `Repository: ${args.owner}/${args.name}
Path: ${args.path}
Language: ${args.language ?? "unknown"}

--- FILE START ---
${args.content}
--- FILE END ---`;
}

async function summarizeOnce(system: string, user: string): Promise<FileSummary> {
  const raw = await generate({
    model: modelName(),
    system,
    user,
    maxOutputTokens: 600,
    responseSchema: FILE_RESPONSE_SCHEMA,
    thinkingBudget: 0,
  });
  return parseFileSummary(raw);
}

export async function summarizeFile(args: {
  owner: string;
  name: string;
  path: string;
  language: string | null;
  content: string;
}): Promise<FileSummary> {
  const prepared = prepareForModel(args.path, args.content);
  const system = prepared.promptBearing
    ? `${SYSTEM_PROMPT}\n\n${PROMPT_FILE_VARIANT}`
    : SYSTEM_PROMPT;
  const user = userPayload({
    owner: args.owner,
    name: args.name,
    path: args.path,
    language: args.language,
    content: prepared.text,
  });

  let summary: FileSummary | null = null;
  try {
    summary = await summarizeOnce(system, user);
  } catch {
    try {
      summary = await summarizeOnce(`${system}\n\nReturn valid JSON only.`, user);
    } catch {
      return { ...UNAVAILABLE_SUMMARY, key_exports: [], tags: [] };
    }
  }

  let verified = verifySummary(summary.summary, args.content);
  if (!verified.ok) {
    try {
      summary = await summarizeOnce(`${system}\n\n${RETRY_INSTRUCTION}`, user);
      verified = verifySummary(summary.summary, args.content);
    } catch {
      return { ...UNAVAILABLE_SUMMARY, key_exports: [], tags: [] };
    }
  }

  if (!verified.ok) {
    return { ...UNAVAILABLE_SUMMARY, key_exports: [], tags: [] };
  }

  return summary;
}

export function createSummarizeLimit() {
  return pLimit(concurrency());
}

function isValidFolderGloss(gloss: string, used: ReadonlySet<string>): boolean {
  const trimmed = gloss.trim();
  if (trimmed.length < 20 || trimmed.length > 120) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (GLOSS_BANNED.test(trimmed)) return false;
  if (GLOSS_GENERIC_PREFIX.test(trimmed)) return false;
  if (used.has(trimmed.toLowerCase())) return false;
  return true;
}

function deriveGlossFromRoles(roles: string[]): string {
  const counts = new Map<string, number>();
  for (const role of roles) {
    for (const raw of role.split(/\s+/)) {
      const word = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (word.length < 2) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([word]) => word);
  if (top.length === 0) return "";
  return `Contains ${top.join(" ")}`;
}

function folderDisplayName(folderPath: string): string {
  const parts = folderPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? (folderPath || "repository root");
}

async function requestFolderGloss(
  folderPath: string,
  roles: string[],
  used: ReadonlySet<string>,
): Promise<string | null> {
  const clipped = roles.slice(0, 40);
  const user = `Folder name: ${folderDisplayName(folderPath)}
Path: ${folderPath || "/"}
Roles of files directly inside it:
${clipped.map((role) => `- ${role}`).join("\n") || "(no direct files)"}

What is this folder for?
Example of good output: Dispatches Jira and Slack notifications for agent run status.`;

  try {
    const raw = await generate({
      model: overviewModelName(),
      system: GLOSS_SYSTEM,
      user,
      maxOutputTokens: 120,
      responseSchema: GLOSS_RESPONSE_SCHEMA,
      thinkingBudget: 0,
    });
    const parsed = FolderGlossSchema.parse(JSON.parse(raw) as unknown);
    const gloss = parsed.gloss.trim();
    if (!isValidFolderGloss(gloss, used)) return null;
    return gloss;
  } catch {
    return null;
  }
}

export async function generateFolderGloss(
  folderPath: string,
  roles: string[],
  used: Set<string>,
): Promise<string | null> {
  const first = await requestFolderGloss(folderPath, roles, used);
  if (first) {
    used.add(first.toLowerCase());
    return first;
  }
  const second = await requestFolderGloss(folderPath, roles, used);
  if (second) {
    used.add(second.toLowerCase());
    return second;
  }
  const derived = deriveGlossFromRoles(roles);
  if (isValidFolderGloss(derived, used)) {
    used.add(derived.toLowerCase());
    return derived;
  }
  return null;
}

export async function generateRepoOverview(args: {
  name: string;
  description: string | null;
  folderGlosses: { path: string; gloss: string }[];
  languages: string[];
  largestRoles: { path: string; role: string }[];
}): Promise<RepoOverview> {
  const system = `You write onboarding overviews of software repositories for new engineers.
Never reproduce source code. Never quote string literals or configuration values.
Respond with a single JSON object and nothing else:
{
  "what_it_is": "2-3 sentences",
  "stack": ["Next.js", "Postgres", "..."],
  "entry_points": ["src/app/page.tsx", "..."],
  "how_it_works": "3-4 sentences describing the main flow through the system",
  "start_here": ["3-5 paths a new engineer should read first"]
}`;
  const user = `Repository: ${args.name}
Description: ${args.description ?? "none"}
Languages: ${args.languages.join(", ") || "unknown"}
Folder glosses:
${args.folderGlosses.map((f) => `- ${f.path || "/"}: ${f.gloss}`).join("\n")}
Largest files (by size) and their roles:
${args.largestRoles.map((f) => `- ${f.path}: ${f.role}`).join("\n")}`;

  const parse = (raw: string) => OverviewSchema.parse(JSON.parse(raw) as unknown);
  try {
    return parse(
      await generate({
        model: overviewModelName(),
        system,
        user,
        maxOutputTokens: 800,
        responseSchema: OVERVIEW_RESPONSE_SCHEMA,
      }),
    );
  } catch {
    try {
      return parse(
        await generate({
          model: overviewModelName(),
          system: `${system}\n\nReturn valid JSON only.`,
          user,
          maxOutputTokens: 800,
          responseSchema: OVERVIEW_RESPONSE_SCHEMA,
        }),
      );
    } catch {
      return {
        what_it_is: `${args.name} is a software project${args.description ? ` — ${args.description}` : ""}.`,
        stack: args.languages,
        entry_points: args.largestRoles.slice(0, 3).map((f) => f.path),
        how_it_works:
          "The indexed files describe the system's structure. Explore the constellation to see how modules connect.",
        start_here: args.largestRoles.slice(0, 5).map((f) => f.path),
      };
    }
  }
}
