// Run the Layout Board migration and/or seed against Neon (or any Postgres).
//   npm run board:migrate
//   OWNER_CLERK_ID=user_2abc OWNER_NAME="Josh" npm run board:seed
// Needs DATABASE_URL (Neon connection string). Load it from your shell or `node --env-file=.env.local`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL to your Neon connection string."); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: /neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  if (cmd === "migrate") {
    await client.query(readFileSync(join(root, "neon/layout-board.sql"), "utf8"));
    console.log("Layout Board schema applied.");
  } else if (cmd === "seed") {
    const owner = process.env.OWNER_CLERK_ID;
    const name = process.env.PLAN_NAME || "Disco Pizza · 910 OH-28";
    const ownerName = process.env.OWNER_NAME || null;
    const base = readFileSync(join(root, "neon/plan-base.json"), "utf8");
    const exists = await client.query("select id from lb_floor_plans where name = $1", [name]);
    if (exists.rowCount) { console.log("Plan already seeded:", exists.rows[0].id); }
    else {
      if (!owner) throw new Error("Set OWNER_CLERK_ID to your Clerk user id (Clerk Dashboard, Users, user_...).");
      await client.query("begin");
      const { rows } = await client.query("insert into lb_floor_plans(name, base, created_by) values ($1, $2::jsonb, $3) returning id", [name, base, owner]);
      const id = rows[0].id;
      const empty = JSON.stringify({ t: {}, dups: [] });
      await client.query("insert into lb_plan_members(plan_id, user_id, role, display_name) values ($1,$2,'owner',$3)", [id, owner, ownerName]);
      await client.query("insert into lb_layouts(plan_id, rev, state, updated_by, updated_by_name) values ($1,1,$2::jsonb,$3,$4)", [id, empty, owner, ownerName]);
      await client.query("insert into lb_layout_revisions(plan_id, rev, state, note, saved_by, saved_by_name) values ($1,1,$2::jsonb,'Initial layout',$3,$4)", [id, empty, owner, ownerName]);
      await client.query("commit");
      console.log("Seeded plan", id);
    }
  } else { console.error("Usage: board-db.mjs migrate|seed"); process.exit(1); }
} catch (e) { await client.query("rollback").catch(() => {}); console.error(e.message); process.exitCode = 1; }
finally { await client.end(); }
