/**
 * In dev, VITE_API_URL is unset → same-origin `/api/...` (Vite proxy to localhost:3001).
 * For production builds on static hosts (Vercel, etc.), you MUST set VITE_API_URL to your API origin
 * (e.g. https://your-app.fly.dev) or `/api/...` hits the static site and returns 404.
 */
let warnedMissingApiBase = false;

export function apiUrl(path) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    if (import.meta.env.PROD && !warnedMissingApiBase && p.startsWith("/api")) {
      warnedMissingApiBase = true;
      console.warn(
        "[api] VITE_API_URL is unset — requests use the page origin. Static hosts return 404 for /api. Set VITE_API_URL to your backend URL and rebuild."
      );
    }
    return p;
  }
  return `${base}${p}`;
}
