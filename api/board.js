// Vercel Serverless Function: every Layout Board call goes to /api/board?p=<route>&...
// A single fixed path keeps this independent of Vercel's dynamic-route matching.
// Example: /api/board?p=plans/<id>/layout&since=3
import { getRouter } from "./_lib/board-prod.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const router = getRouter();
  if (!router) return res.status(500).json({ error: "not_configured", detail: "Set DATABASE_URL and CLERK_SECRET_KEY" });
  const url = new URL(req.url, "http://x");
  const search = Object.fromEntries(url.searchParams);
  const path = String(search.p || "").split("/").filter(Boolean);
  delete search.p;
  const auth = req.headers.authorization || "";
  const out = await router({
    method: req.method,
    path,
    body: req.body,
    token: auth.startsWith("Bearer ") ? auth.slice(7) : null,
    search,
  });
  res.status(out.status).json(out.json);
}
