import { languageFromPath, parentFolder, type ImportEdge } from "shared";

function normalizePath(filePath: string): string {
  const parts: string[] = [];
  for (const part of filePath.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function collect(regex: RegExp, text: string, group = 1): string[] {
  const out: string[] = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[group]?.trim();
    if (value) out.push(value);
  }
  return out;
}

function specifiersFromJs(text: string): string[] {
  return [
    ...collect(/from\s+['"]([^'"]+)['"]/g, text),
    ...collect(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, text),
    ...collect(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, text),
  ];
}

function specifiersFromPython(text: string): string[] {
  const froms = collect(/^from\s+([a-zA-Z0-9_.]+)\s+import/gm, text);
  const imports = collect(/^import\s+([a-zA-Z0-9_.]+)/gm, text);
  return [...froms, ...imports].map((mod) => mod.replace(/\./g, "/"));
}

function specifiersFromGo(text: string): string[] {
  const singles = collect(/^import\s+(?:[a-zA-Z0-9_]\s+)?["']([^"']+)["']/gm, text);
  const blocks: string[] = [];
  const blockRe = /import\s*\(([\s\S]*?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const inner = match[1] ?? "";
    blocks.push(...collect(/["']([^"']+)["']/g, inner));
  }
  return [...singles, ...blocks];
}

function specifiersFromJava(text: string): string[] {
  return collect(/^import\s+(?:static\s+)?([a-zA-Z0-9_.]+)\s*;/gm, text).map((fqn) =>
    fqn.replace(/\./g, "/"),
  );
}

function specifiersFromCSharp(text: string): string[] {
  return collect(/^using\s+([a-zA-Z0-9_.]+)\s*;/gm, text).map((ns) => ns.replace(/\./g, "/"));
}

export function extractSpecifiers(filePath: string, text: string): string[] {
  const lang = languageFromPath(filePath);
  if (lang === "Python") return specifiersFromPython(text);
  if (lang === "Go") return specifiersFromGo(text);
  if (lang === "Java" || lang === "Kotlin") return specifiersFromJava(text);
  if (lang === "C#") return specifiersFromCSharp(text);
  if (
    lang === "TypeScript" ||
    lang === "JavaScript" ||
    lang === "Vue" ||
    lang === "Svelte"
  ) {
    return specifiersFromJs(text);
  }
  return specifiersFromJs(text);
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go"];
const INDEX_FILES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/__init__.py"];

export function resolveSpecifier(
  fromPath: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  const trimmed = spec.trim();
  if (!trimmed || trimmed.startsWith("http:") || trimmed.startsWith("https:")) return null;
  if (trimmed.startsWith("node:") || trimmed.startsWith("jsr:")) return null;

  const dir = parentFolder(fromPath);
  const bases: string[] = [];

  if (trimmed.startsWith(".")) {
    bases.push(normalizePath(`${dir}/${trimmed}`));
  } else {
    bases.push(normalizePath(trimmed));
    bases.push(normalizePath(`src/${trimmed}`));
    if (trimmed.startsWith("@/")) {
      bases.push(normalizePath(`src/${trimmed.slice(2)}`));
      bases.push(normalizePath(trimmed.slice(2)));
    }
  }

  const candidates: string[] = [];
  for (const base of bases) {
    candidates.push(base);
    for (const ext of EXTENSIONS) candidates.push(base + ext);
    for (const index of INDEX_FILES) candidates.push(base + index);
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

export type { ImportEdge };

export function buildImportEdges(
  files: { path: string; text: string }[],
): ImportEdge[] {
  const fileSet = new Set(files.map((f) => f.path));
  const seen = new Set<string>();
  const edges: ImportEdge[] = [];

  for (const file of files) {
    const specs = extractSpecifiers(file.path, file.text);
    for (const spec of specs) {
      const resolved = resolveSpecifier(file.path, spec, fileSet);
      if (!resolved || resolved === file.path) continue;
      const key = `${file.path}\0${resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromPath: file.path, toPath: resolved });
    }
  }

  return edges;
}
