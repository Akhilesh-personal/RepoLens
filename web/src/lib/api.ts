const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function api(input: string, init?: RequestInit): Promise<Response> {
  const url = input.startsWith("http://") || input.startsWith("https://") ? input : `${apiBase}${input}`;
  return fetch(url, { ...init, credentials: "include" });
}
