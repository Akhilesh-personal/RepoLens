const BLOCKED_DIR_SEGMENTS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
];

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "cargo.lock",
  "go.sum",
]);

const EXACT_BLOCKED_NAMES = new Set([
  ".env",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".htpasswd",
  "terraform.tfstate",
  "terraform.tfstate.backup",
]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

const BLOCKED_GLOBS = [
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.jks",
  "*.ppk",
  "credentials.*",
  "secrets.*",
  "*secret*.json",
  "*secrets*.yaml",
  "*secrets*.yml",
  "serviceaccount*.json",
  "*service-account*.json",
  "gha-creds-*.json",
  "*.tfvars",
].map(globToRegExp);

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileName(filePath: string): string {
  const parts = normalizeRepoPath(filePath).split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function isBlockedPath(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments.slice(0, -1)) {
    if (BLOCKED_DIR_SEGMENTS.includes(segment.toLowerCase())) return true;
  }
  const name = fileName(normalized);
  const lower = name.toLowerCase();
  if (EXACT_BLOCKED_NAMES.has(lower)) return true;
  if (LOCKFILES.has(lower)) return true;
  return BLOCKED_GLOBS.some((re) => re.test(name));
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(8000, buf.length));
  return sample.includes(0);
}

export function maxFileBytes(): number {
  const n = Number(process.env.MAX_FILE_BYTES ?? 200000);
  return Number.isFinite(n) && n > 0 ? n : 200000;
}

export function isTooLarge(sizeBytes: number): boolean {
  return sizeBytes > maxFileBytes();
}

type SecretPattern = { source: string; flags: string };

const SECRET_PATTERNS: SecretPattern[] = [
  { source: "AKIA[0-9A-Z]{16}", flags: "g" },
  {
    source: "aws.{0,20}(secret|private).{0,20}['\"][0-9a-zA-Z/+]{40}['\"]",
    flags: "gi",
  },
  { source: "gh[pousr]_[A-Za-z0-9]{20,}", flags: "g" },
  { source: "sk-ant-[A-Za-z0-9\\-_]{20,}", flags: "g" },
  { source: "sk-[A-Za-z0-9]{32,}", flags: "g" },
  { source: "AIza[0-9A-Za-z\\-_]{35}", flags: "g" },
  { source: "xox[baprs]-[A-Za-z0-9-]{10,}", flags: "g" },
  { source: "(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}", flags: "g" },
  {
    source: "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
    flags: "g",
  },
  {
    source:
      "-----BEGIN[A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END[A-Z ]*PRIVATE KEY-----",
    flags: "g",
  },
  {
    source: "(postgres|postgresql|mysql|mongodb(\\+srv)?|redis|amqp)://[^\\s'\"]+",
    flags: "gi",
  },
  {
    source:
      "\\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)\\b\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
    flags: "gi",
  },
];

const REDACTED = "«REDACTED»";
const PROMPT_OMITTED = "«PROMPT_TEXT_OMITTED»";

export function redactSecrets(text: string): { text: string; hits: number } {
  let result = text;
  let hits = 0;
  for (const { source, flags } of SECRET_PATTERNS) {
    const re = new RegExp(source, flags);
    result = result.replace(re, () => {
      hits += 1;
      return REDACTED;
    });
  }
  return { text: result, hits };
}

const PROMPT_PATH_RE = /(^|\/)prompts(\/|$)|prompt|\.prompt$|\.jinja$|\.j2$/i;

const PROMPT_MARKERS = [
  "You are",
  "Your task",
  "Respond in",
  "Do not",
  "###",
  "<instructions>",
];

function extractStringLiterals(text: string): string[] {
  const literals: string[] = [];
  const triple = /("""[\s\S]*?"""|'''[\s\S]*?''')/g;
  let match: RegExpExecArray | null;
  while ((match = triple.exec(text)) !== null) {
    literals.push(match[0].slice(3, -3));
  }
  const quoted = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  while ((match = quoted.exec(text)) !== null) {
    literals.push(match[2] ?? "");
  }
  return literals;
}

function markerCount(literal: string): number {
  return PROMPT_MARKERS.filter((marker) => literal.includes(marker)).length;
}

export function isPromptBearing(filePath: string, content: string): boolean {
  if (PROMPT_PATH_RE.test(normalizeRepoPath(filePath))) return true;
  for (const literal of extractStringLiterals(content)) {
    if (literal.length > 400 && markerCount(literal) >= 2) return true;
  }
  return false;
}

function omitLongStringLiterals(text: string): string {
  let result = text.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, (block) => {
    const inner = block.slice(3, -3);
    if (inner.length > 200) {
      const quote = block.startsWith('"""') ? '"""' : "'''";
      return `${quote}${PROMPT_OMITTED}${quote}`;
    }
    return block;
  });
  result = result.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, (full, q: string, inner: string) => {
    if (inner.length > 200) return `${q}${PROMPT_OMITTED}${q}`;
    return full;
  });
  return result;
}

export function prepareForModel(
  filePath: string,
  content: string,
): { text: string; promptBearing: boolean; secretHits: number } {
  const promptBearing = isPromptBearing(filePath, content);
  let working = content;
  if (promptBearing) {
    working = omitLongStringLiterals(working);
  }
  const redacted = redactSecrets(working);
  return {
    text: redacted.text.slice(0, 60_000),
    promptBearing,
    secretHits: redacted.hits,
  };
}

function normalizeForShingle(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function overlappingShingles(text: string, size: number): string[] {
  const words = text.split(" ").filter(Boolean);
  if (words.length < size) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - size; i++) {
    out.push(words.slice(i, i + size).join(" "));
  }
  return out;
}

const CODE_SIGNALS = [
  "{",
  "}",
  "=>",
  "();",
  "def ",
  "function ",
  "import ",
  "const ",
  "return ",
];

export function verifySummary(
  summary: string,
  originalText: string,
): { ok: boolean; reason?: string } {
  if (redactSecrets(summary).hits > 0) {
    return { ok: false, reason: "secret_pattern" };
  }
  if (summary.includes(REDACTED) || summary.includes(PROMPT_OMITTED)) {
    return { ok: false, reason: "redaction_marker" };
  }
  const normSummary = normalizeForShingle(summary);
  const normOriginal = normalizeForShingle(originalText);
  for (const shingle of overlappingShingles(normSummary, 8)) {
    if (normOriginal.includes(shingle)) {
      return { ok: false, reason: "verbatim_overlap" };
    }
  }
  const signalHits = CODE_SIGNALS.filter((token) => summary.includes(token)).length;
  if (signalHits >= 3) {
    return { ok: false, reason: "code_signal" };
  }
  return { ok: true };
}

export const UNAVAILABLE_SUMMARY = {
  role: "Unavailable",
  summary: "A safe summary could not be generated for this file.",
} as const;
