// Production wiring: Neon for data, Clerk for identity.
import { neon } from "@neondatabase/serverless";
import { verifyToken, createClerkClient } from "@clerk/backend";
import { createBoardRouter } from "./board-router.js";

let router;
export function getRouter() {
  if (router) return router;
  const url = process.env.DATABASE_URL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!url || !secretKey) return null;
  const sql = neon(url);
  const clerk = createClerkClient({ secretKey });
  router = createBoardRouter({
    query: (text, params) => sql.query(text, params),
    authenticate: async (token) => {
      try { const p = await verifyToken(token, { secretKey }); return p.sub || null; } catch { return null; }
    },
    getName: async (id) => {
      const u = await clerk.users.getUser(id);
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.emailAddresses?.[0]?.emailAddress?.split("@")[0] || null;
    },
  });
  return router;
}
