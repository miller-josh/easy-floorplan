# Switching Auth to Clerk

This swaps the login system from Supabase Auth to **Clerk**, while **Supabase still stores your floor plans**. Clerk handles sign-in and user accounts; Supabase trusts Clerk's session tokens via its native third-party auth integration, and row-level security keys your data to your Clerk user id.

Time: ~20 min. Cost: $0 (Clerk free tier + Supabase free tier).

---

## What changed in the code

| File | Change |
|------|--------|
| `src/main.jsx` | Wraps the app in `<ClerkProvider>`, resolves the Clerk session, builds the Clerk-bound Supabase client, routes `#migrate`. |
| `src/supabaseClient.js` | New `useClerkSupabaseClient()` hook — a Supabase client that attaches the Clerk token to every request. |
| `src/Auth.jsx` | Now renders Clerk's prebuilt `<SignIn>` component (keeps the "use offline" skip option). |
| `src/FloorPlanTool.jsx` | Gets the user + Supabase client as props; cloud reads/writes go through the Clerk-bound client. |
| `src/Migrate.jsx` | Same — uses the injected client + Clerk user id. |
| `package.json` | Adds `@clerk/clerk-react`. |
| `clerk-migration.sql` | One-time DB migration (user_id → text, RLS keyed to the Clerk id). |

The app still works with **no Clerk key** — it falls back to offline/localStorage mode, same as before.

---

## Step 1 — Create a Clerk application (~3 min)

1. Sign up at [clerk.com](https://clerk.com) and create an application.
2. Pick your sign-in methods (email + password is fine; you can add Google etc.).
3. From **API Keys**, copy the **Publishable key** (`pk_test_...` or `pk_live_...`).

## Step 2 — Connect Clerk to Supabase (~3 min)

This is what lets Supabase trust Clerk's tokens.

1. In the **Clerk Dashboard**, open the **Connect with Supabase** page (Configure → Integrations → Supabase, or search "Supabase").
2. Select your application/instance and click **Activate Supabase integration**.
3. Copy the **Clerk domain** it shows you (looks like `your-app.clerk.accounts.dev`).
4. In the **Supabase Dashboard** → **Authentication → Sign In / Providers → Third-Party Auth** (a.k.a. "Add provider") → choose **Clerk**.
5. Paste the Clerk domain and save.

This wizard also adds the required `role: authenticated` claim to Clerk's session tokens — the RLS policies depend on it.

## Step 3 — Run the database migration (~1 min)

1. Supabase Dashboard → **SQL Editor → New Query**.
2. Paste the contents of `clerk-migration.sql` and **Run**.

This converts `user_id` from a UUID to text and rewrites the RLS policies to key off your Clerk id (`auth.jwt()->>'sub'`).

## Step 4 — Set environment variables

Add the Clerk key alongside your existing Supabase vars.

**Local (`.env`):**
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

**Vercel:** Settings → Environment Variables → add `VITE_CLERK_PUBLISHABLE_KEY`. Keep the two Supabase vars. Redeploy.

## Step 5 — Install the dependency & deploy

```
npm install @clerk/clerk-react
git add -A
git commit -m "Switch auth from Supabase to Clerk"
git push
```

(If you copy the included `package.json` instead, just run `npm install` — it already lists `@clerk/clerk-react` and keeps `jspdf`.)

## Step 6 — Bring your existing designs across

Your old designs are still tagged with your old Supabase user id, so they won't appear under your new Clerk account until you remap them. Two ways:

- **Easy (no SQL):** *before* you stop using the old login, Export (⬇️) each design to a `.json` file. After switching to Clerk and signing in, Import (⬆️) each and Save — they'll be re-created under your Clerk id.
- **Bulk (SQL):** sign into the new app once, grab your Clerk user id from the Clerk Dashboard (Users — `user_2...`), then in Supabase run:
  ```sql
  update public.designs set user_id = 'user_2YOURID' where user_id = 'old-supabase-uuid';
  ```
  (`select distinct user_id from public.designs;` lists the old ids.)

---

## Notes

- **Shannon's account:** she just signs up through the new Clerk sign-in screen. Her designs stay separate via RLS, same as before.
- **The heartbeat cron still works** — it pings the DB to keep the Supabase project awake; it doesn't need auth.
- **Offline mode** still exists: if `VITE_CLERK_PUBLISHABLE_KEY` is absent, or you click "Skip" on the sign-in screen, the app uses localStorage only.
- **Supabase Auth is no longer used.** You can leave the old auth users in place; nothing references them after the migration.
