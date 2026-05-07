/**
 * In dev, VITE_API_URL is unset → same-origin `/api/...` (Vite proxy to localhost:3001).
 * Set VITE_API_URL in repo-root `.env` (or hosting env) to your API base, e.g. https://xxx.fly.dev
 */
export function apiUrl(path) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
