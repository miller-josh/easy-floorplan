// Test API server: real router + real Postgres, fake Clerk ("tok:<userId>" tokens), CORS open.
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createBoardRouter } from "../../api/_lib/board-router.js";
import { TEST_URL, NAMES } from "../helpers.js";

export async function startApi(port = 4010) {
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await pool.query("drop schema public cascade; create schema public;");
  await pool.query(readFileSync(new URL("../../neon/layout-board.sql", import.meta.url), "utf8"));
  const base = readFileSync(new URL("../../neon/plan-base.json", import.meta.url), "utf8");
  const { rows } = await pool.query("insert into lb_floor_plans(name, base, created_by) values ('Disco Pizza · 910 OH-28', $1::jsonb, 'user_josh') returning id", [base]);
  const planId = rows[0].id;
  const empty = '{"t":{},"dups":[]}';
  await pool.query("insert into lb_plan_members(plan_id,user_id,role,display_name) values ($1,'user_josh','owner','Josh')", [planId]);
  await pool.query("insert into lb_layouts(plan_id,rev,state,updated_by,updated_by_name) values ($1,1,$2,'user_josh','Josh')", [planId, empty]);
  await pool.query("insert into lb_layout_revisions(plan_id,rev,state,note,saved_by,saved_by_name) values ($1,1,$2,'Initial layout','user_josh','Josh')", [planId, empty]);
  const router = createBoardRouter({
    query: async (t, p) => (await pool.query(t, p)).rows,
    authenticate: async (tok) => (tok.startsWith("tok:") ? tok.slice(4) : null),
    getName: async (id) => NAMES[id] || id.replace("user_", "").replace(/^./, (c) => c.toUpperCase()),
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://x");
    const auth = req.headers.authorization || "";
    const out = await router({ method: req.method, path: url.pathname.replace(/^\/api\/board\/?/, "").split("/").filter(Boolean),
      body: body ? JSON.parse(body) : undefined, token: auth.startsWith("Bearer ") ? auth.slice(7) : null, search: Object.fromEntries(url.searchParams) });
    res.writeHead(out.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(out.json));
  });
  await new Promise((r) => server.listen(port, r));
  return { planId, pool, close: async () => { server.close(); await pool.end(); } };
}
