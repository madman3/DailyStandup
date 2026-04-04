/**
 * In dev, VITE_API_URL is unset → same-origin `/api/...` (Vite proxy to localhost:3001).
 * In production (Vercel), set VITE_API_URL to your Railway URL, e.g. https://xxx.up.railway.app
 */
export function apiUrl(path) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
