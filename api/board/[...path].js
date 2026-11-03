// Vercel Serverless Function: all Layout Board endpoints under /api/board/*
import { getRouter } from "../_lib/board-prod.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const router = getRouter();
  if (!router) return res.status(500).json({ error: "not_configured", detail: "Set DATABASE_URL and CLERK_SECRET_KEY" });
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/api\/board\/?/, "").split("/").filter(Boolean);
  const auth = req.headers.authorization || "";
  const out = await router({
    method: req.method,
    path,
    body: req.body,
    token: auth.startsWith("Bearer ") ? auth.slice(7) : null,
    search: Object.fromEntries(url.searchParams),
  });
  res.status(out.status).json(out.json);
}
