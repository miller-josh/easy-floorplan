// Layout Board API logic. Framework free so it can run on Vercel (api/board.js)
// and in tests against a local Postgres.
//
// ctx = {
//   query(text, params) -> Promise<row[]>        database access (Neon in production)
//   authenticate(token) -> Promise<string|null>  verified Clerk user id
//   getName(userId)     -> Promise<string|null>  display name for History / member lists
// }

export class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{20,64}$/i;
const WRITER = new Set(["owner", "editor"]);

function validState(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (!s.t || typeof s.t !== "object" || Array.isArray(s.t)) return false;
  if (!Array.isArray(s.dups)) return false;
  for (const k in s.t) {
    const v = s.t[k];
    if (!v || typeof v !== "object") return false;
    for (const f of ["dx", "dy", "rot", "sx", "sy"]) if (typeof v[f] !== "number" || !Number.isFinite(v[f])) return false;
    if (typeof v.hidden !== "boolean") return false;
  }
  for (const d of s.dups) if (!d || typeof d.id !== "string" || !Number.isInteger(d.src)) return false;
  return true;
}

export function createBoardRouter(ctx) {
  const { query } = ctx;

  async function membership(planId, userId) {
    if (!UUID.test(planId)) throw new HttpError(404, "not_found");
    const rows = await query("select role, display_name from lb_plan_members where plan_id = $1 and user_id = $2", [planId, userId]);
    if (!rows.length) throw new HttpError(404, "not_found");
    let { role, display_name } = rows[0];
    if (!display_name) {
      display_name = await ctx.getName(userId).catch(() => null);
      if (display_name) await query("update lb_plan_members set display_name = $3 where plan_id = $1 and user_id = $2", [planId, userId, display_name]);
    }
    return { role, name: display_name };
  }
  const layoutRow = async (planId) => (await query(
    "select rev, state, updated_by, updated_by_name, updated_at from lb_layouts where plan_id = $1", [planId]))[0];

  return async function handle({ method, path, body, token, search }) {
    try {
      const userId = token ? await ctx.authenticate(token) : null;
      if (!userId) throw new HttpError(401, "unauthorized");
      const seg = path.filter(Boolean);

      // TEMPORARY setup check: GET /whoami. Shows what this deployment sees (no secrets).
      if (seg[0] === "whoami" && method === "GET") {
        const [db] = await query("select current_database() as database, current_setting('neon.endpoint_id', true) as endpoint, (select count(*)::int from lb_floor_plans) as plans, (select count(*)::int from lb_plan_members) as members");
        const mem = await query("select left(user_id, 14) as id_prefix, length(user_id) as id_length, role from lb_plan_members");
        return { status: 200, json: { seenUserId: userId, seenUserIdLength: userId.length, ...db, memberRows: mem } };
      }

      // GET /plans
      if (seg[0] === "plans" && seg.length === 1 && method === "GET") {
        const rows = await query(
          "select p.id, p.name, m.role from lb_floor_plans p join lb_plan_members m on m.plan_id = p.id where m.user_id = $1 order by p.created_at", [userId]);
        return { status: 200, json: { plans: rows, userId } };
      }

      // POST /invites/:token/accept
      if (seg[0] === "invites" && seg[2] === "accept" && method === "POST") {
        if (!TOKEN.test(seg[1] || "")) throw new HttpError(404, "invalid_invite");
        const name = await ctx.getName(userId).catch(() => null);
        try {
          const rows = await query("select lb_accept_invite($1, $2, $3) as plan_id", [userId, name, seg[1]]);
          return { status: 200, json: { planId: rows[0].plan_id } };
        } catch (e) {
          if (/invalid_invite/.test(e.message)) throw new HttpError(404, "invalid_invite");
          throw e;
        }
      }

      if (seg[0] !== "plans" || !seg[1]) throw new HttpError(404, "not_found");
      const planId = seg[1];
      const me = await membership(planId, userId);
      const isOwner = me.role === "owner";
      const sub = seg[2];

      // GET /plans/:id
      if (!sub && method === "GET") {
        const [plan] = await query("select id, name, base from lb_floor_plans where id = $1", [planId]);
        return { status: 200, json: { plan, layout: await layoutRow(planId), role: me.role, userId } };
      }

      if (sub === "layout") {
        // GET /plans/:id/layout?since=N  (polled by open boards)
        if (method === "GET") {
          const lay = await layoutRow(planId);
          if (String(lay.rev) === search.since) return { status: 200, json: { rev: lay.rev, unchanged: true, role: me.role } };
          return { status: 200, json: { ...lay, role: me.role } };
        }
        // POST /plans/:id/layout
        if (method === "POST") {
          if (!WRITER.has(me.role)) throw new HttpError(403, "not_writer");
          if (!Number.isInteger(body?.expectedRev) || !validState(body?.state)) throw new HttpError(400, "bad_request");
          const note = typeof body.note === "string" ? body.note.slice(0, 200) : null;
          try {
            const rows = await query("select lb_save_layout($1, $2, $3, $4, $5::jsonb, $6) as rev",
              [userId, me.name, planId, body.expectedRev, JSON.stringify(body.state), note]);
            return { status: 200, json: { rev: rows[0].rev, updated_by_name: me.name } };
          } catch (e) {
            if (/conflict/.test(e.message)) throw new HttpError(409, "conflict", { layout: await layoutRow(planId) });
            if (/not_writer/.test(e.message)) throw new HttpError(403, "not_writer");
            throw e;
          }
        }
      }

      if (sub === "revisions" && method === "GET") {
        if (!seg[3]) {
          const rows = await query(
            "select rev, saved_by, saved_by_name, saved_at, note from lb_layout_revisions where plan_id = $1 order by rev desc limit 200", [planId]);
          return { status: 200, json: { revisions: rows } };
        }
        const rev = Number(seg[3]);
        if (!Number.isInteger(rev)) throw new HttpError(404, "not_found");
        const rows = await query(
          "select rev, state, saved_by_name, saved_at, note from lb_layout_revisions where plan_id = $1 and rev = $2", [planId, rev]);
        if (!rows.length) throw new HttpError(404, "not_found");
        return { status: 200, json: rows[0] };
      }

      // Owner only below: members and invites
      if (sub === "members" || sub === "invites") {
        if (!isOwner) throw new HttpError(403, "owner_only");

        if (sub === "members" && !seg[3] && method === "GET") {
          const members = await query("select user_id, role, display_name, added_at from lb_plan_members where plan_id = $1 order by added_at", [planId]);
          const invites = await query(
            "select token, role, created_at, expires_at from lb_plan_invites where plan_id = $1 and used_at is null and expires_at > now() order by created_at desc", [planId]);
          return { status: 200, json: { members, invites } };
        }
        if (sub === "members" && seg[3]) {
          const target = decodeURIComponent(seg[3]);
          const rows = await query("select role from lb_plan_members where plan_id = $1 and user_id = $2", [planId, target]);
          if (!rows.length) throw new HttpError(404, "not_found");
          if (rows[0].role === "owner") throw new HttpError(400, "cannot_change_owner");
          if (method === "PATCH") {
            if (!["editor", "viewer"].includes(body?.role)) throw new HttpError(400, "bad_request");
            await query("update lb_plan_members set role = $3 where plan_id = $1 and user_id = $2", [planId, target, body.role]);
            return { status: 200, json: { ok: true } };
          }
          if (method === "DELETE") {
            await query("delete from lb_plan_members where plan_id = $1 and user_id = $2", [planId, target]);
            return { status: 200, json: { ok: true } };
          }
        }
        if (sub === "invites" && !seg[3] && method === "POST") {
          if (!["editor", "viewer"].includes(body?.role)) throw new HttpError(400, "bad_request");
          const rows = await query(
            "insert into lb_plan_invites(plan_id, role, created_by) values ($1, $2, $3) returning token, expires_at", [planId, body.role, userId]);
          return { status: 200, json: rows[0] };
        }
        if (sub === "invites" && seg[3] && method === "DELETE") {
          await query("delete from lb_plan_invites where plan_id = $1 and token = $2", [planId, seg[3]]);
          return { status: 200, json: { ok: true } };
        }
      }
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, json: { error: e.code, ...(e.extra || {}) } };
      console.error("board api error:", e);
      return { status: 500, json: { error: "server_error" } };
    }
  };
}
