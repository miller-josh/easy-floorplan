// Shared test setup: a throwaway Postgres (TEST_DATABASE_URL) with the Layout Board schema.
import { readFileSync } from "node:fs";
import pg from "pg";
import { createBoardRouter } from "../api/_lib/board-router.js";

export const TEST_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres@/lbtest?host=/tmp&port=54329";
export const USERS = { josh: "user_josh", shannon: "user_shannon", al: "user_al", stranger: "user_x" };
export const NAMES = { user_josh: "Josh", user_shannon: "Shannon", user_al: "Al", user_x: "Stranger" };

export async function freshDb() {
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await pool.query("drop schema public cascade; create schema public;");
  await pool.query(readFileSync(new URL("../neon/layout-board.sql", import.meta.url), "utf8"));
  const base = JSON.stringify({ static: [], items: [] });
  const { rows } = await pool.query("insert into lb_floor_plans(name, base, created_by) values ('Test plan', $1::jsonb, $2) returning id", [base, USERS.josh]);
  const planId = rows[0].id;
  await pool.query("insert into lb_plan_members(plan_id,user_id,role,display_name) values ($1,$2,'owner','Josh')", [planId, USERS.josh]);
  await pool.query("insert into lb_layouts(plan_id, rev, state) values ($1,1,'{\"t\":{},\"dups\":[]}')", [planId]);
  await pool.query("insert into lb_layout_revisions(plan_id,rev,state,note,saved_by,saved_by_name) values ($1,1,'{\"t\":{},\"dups\":[]}','Initial layout',$2,'Josh')", [planId, USERS.josh]);
  const router = createBoardRouter({
    query: async (t, p) => (await pool.query(t, p)).rows,
    authenticate: async (tok) => (tok.startsWith("tok:") ? tok.slice(4) : null),
    getName: async (id) => NAMES[id] || null,
  });
  return { pool, planId, router };
}

export const call = (router, user, method, path, body, search = {}) =>
  router({ method, path: path.split("/").filter(Boolean), body, token: user ? "tok:" + user : null, search });

export const st = (dx = 0) => ({ t: { 5: { dx, dy: 0, rot: 0, hidden: false, sx: 1, sy: 1 } }, dups: [] });
