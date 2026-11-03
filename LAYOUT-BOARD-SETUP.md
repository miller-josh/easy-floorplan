# Layout Board setup (Neon)

The Layout Board is a shared, database-backed floor plan editor at `#board`. Layouts live in **Neon** (Postgres). Sign-in stays on **Clerk**. Your existing floor plan designs stay in Supabase; nothing there changes.

How it fits together:

```
browser (Clerk session) --Bearer token--> /api/board/* (Vercel function) --> Neon
```

The browser never talks to the database. `api/board/[...path].js` verifies the Clerk token, checks the person's role (owner, editor, viewer) and runs the SQL. That replaces the row level security in the original handoff schema.

## 1. Create the database (about 3 minutes)

1. Create a project at [neon.tech](https://neon.tech) (free tier is fine).
2. Copy the connection string (Dashboard, Connect). It looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`.

## 2. Add environment variables

Server side only (no `VITE_` prefix), in Vercel: Settings, Environment Variables. Then redeploy.

| Name | Where to get it |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `CLERK_SECRET_KEY` | Clerk Dashboard, API Keys, Secret key (`sk_...`) |

`VITE_CLERK_PUBLISHABLE_KEY` is already set from the Clerk setup.

## 3. Create the tables and seed Disco Pizza

Run these from this repo with `DATABASE_URL` set (for example `export DATABASE_URL='postgresql://...'`):

```bash
npm install
npm run board:migrate
```

Find your Clerk user id in the Clerk Dashboard, Users (it looks like `user_2abc...`), then:

```bash
OWNER_CLERK_ID=user_2abc OWNER_NAME="Josh" npm run board:seed
```

The seed script loads `neon/plan-base.json`, makes you the owner and writes revision 1 ("Initial layout"). It is safe to run twice.

Prefer the Neon SQL Editor? Paste `neon/layout-board.sql` there for step one. Seeding needs the script because the plan JSON is large.

## 4. Use it

Sign in, then open the app and click **Layout Board** (bottom of the left panel), or go to `/#board`.

- **Save for everyone** publishes your draft. Until then only you see it (it is also kept in this browser).
- **Share** (owner only) creates a one-time invite link, 14 day expiry, as editor or viewer. The person signs in with Clerk, opens the link and is added. Owners can change or remove people there.
- **History** lists every save with who and when. Preview shows a revision on the canvas, **Restore** saves it as a new revision.
- If someone else saves first, you get **Keep mine / Use theirs**. Keep mine puts your changes on top of theirs, so neither person's moves are lost. Use theirs drops your draft.

## Differences from the original handoff

| Handoff | Here | Why |
|---|---|---|
| Supabase Auth, `auth.uid()`, uuid user ids | Clerk ids (`text`), checked in the API | The app already uses Clerk |
| Row level security policies | Role checks in `api/board`, no direct DB access from the browser | Neon has no PostgREST layer |
| Supabase Realtime | The open board polls `GET /layout?since=rev` every 4 seconds and when the tab regains focus | Neon has no Realtime. Updates show within a few seconds |
| Invite tokens in base64 | Hex | URL safe |
| Members have no names | `display_name` on members, `saved_by_name` on revisions | History needs names, and Clerk users are not in the database |

`src/board/lib/*.ts` are the handoff files, unchanged. Item ids and pivot math are untouched.

## Tests

```bash
npm test          # API + merge tests (needs a local Postgres, see test/helpers.js)
npm run test:e2e  # headless Chromium: two people editing, conflicts, invites, history, DXF
```

Both use a throwaway local Postgres through `TEST_DATABASE_URL` (defaults to a socket at `/tmp:54329`). They never touch Neon.
