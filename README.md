# 🍕 Easy Floor Plan — Complete Setup Guide

Interactive floor plan designer with cloud sync, file export/import, and migration tools.

This guide covers everything: Supabase database setup, Vercel deployment, keep-alive cron, and migrating your existing designs.

---

## What's In This Project

```
easy-floorplan/
├── src/
│   ├── main.jsx              App entry — auth flow + route to migrate page
│   ├── FloorPlanTool.jsx     Main tool — grid, shapes, drag, rotate, save/load
│   ├── Auth.jsx              Login / signup screen (with offline skip option)
│   ├── Migrate.jsx           One-time migration tool (localStorage + .json → cloud)
│   └── supabaseClient.js     Supabase connection config
├── api/
│   └── heartbeat.js          Serverless function — daily Supabase keep-alive ping
├── index.html                HTML entry point
├── package.json              Dependencies (React + Supabase JS)
├── vite.config.js            Vite build config
├── vercel.json               Cron job schedule (daily heartbeat)
├── supabase-setup.sql        Database table + security policies (run once)
├── .env.example              Template for API keys
├── .gitignore
└── README.md                 ← You are here
```

### Storage Modes

The app supports three ways to store designs, and they all coexist:

| Mode | How it works | When to use |
|---|---|---|
| **Cloud (Supabase)** | Saves to a PostgreSQL database. Accessible from any device. | Primary mode once set up |
| **Offline (localStorage)** | Saves in the browser. Click "Skip" on login. | Quick use, no account needed |
| **File export/import** | Download/upload .json files | Backups, sharing, migration |

---

## Step 1: Create a Supabase Project (~3 minutes)

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login works)
2. Click **New Project**
3. Fill in:
   - **Name:** `easy-floorplan`
   - **Database Password:** generate a strong one and save it
   - **Region:** US East (closest to Ohio)
4. Click **Create new project** — takes ~2 minutes to spin up

## Step 2: Create the Database Table (~1 minute)

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Paste the entire contents of `supabase-setup.sql`
4. Click **Run**
5. You should see "Success. No rows returned" — that's correct

This creates a `designs` table with Row Level Security (RLS), meaning each
user can only see and modify their own designs. The table stores:

- Design name, grid dimensions, shape count (for listing)
- Full design data as JSON (shapes, positions, rotations, colors)
- Timestamps for sorting by most recently updated

## Step 3: Get Your API Keys (~1 minute)

1. In Supabase dashboard → **Settings** → **API** (under Configuration)
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — the long string under "Project API keys"

The anon key is safe to use in frontend code — it's designed for that.
RLS policies prevent unauthorized access to other users' data.

## Step 4: Configure Vercel (~2 minutes)

1. Go to your project at [vercel.com](https://vercel.com)
2. **Settings** → **Environment Variables**
3. Add these three variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `CRON_SECRET` | Any random string, 16+ characters (for heartbeat security) |

4. Click **Save**

## Step 5: Deploy (~2 minutes)

Replace the files in your GitHub repo with everything in this package, then push:

```bash
# From your local repo directory
git add -A
git commit -m "Add Supabase cloud sync, migration, and heartbeat"
git push
```

Vercel auto-deploys on push. After deploy, verify the cron is registered:
**Vercel Dashboard → Settings → Cron Jobs** — you should see `/api/heartbeat` listed.

## Step 6: Create Your Accounts (~1 minute each)

1. Open your app — you'll see a login screen
2. Click **Sign up**, enter your email + password (min 6 characters)
3. Check your email for a confirmation link (check spam folder)
4. Click the link, then sign in
5. Repeat for Shannon when she's ready

## Step 7: Migrate Your Existing Designs (~2 minutes)

If you have designs saved in localStorage or as .json files on disk:

1. Open the app **in the same browser** where your localStorage designs live
2. Sign in to your account
3. Go to: `https://easy-floorplan.vercel.app/#migrate`
4. Your localStorage designs auto-populate in the list
5. Click **"+ Add .json files"** if you also have exported .json files (multi-select works)
6. Check the ones you want, click **"Migrate to Cloud"**
7. Review the results, click **"Done"**

Your localStorage copies stay untouched — the migration copies them to the cloud, it doesn't delete the originals.

---

## How the Heartbeat Works

Supabase free tier pauses projects after 7 days of no API activity.
The heartbeat prevents this automatically:

- `vercel.json` schedules a daily cron at noon UTC (~8 AM Eastern)
- Vercel calls `/api/heartbeat` which runs a lightweight count query
- That registers as Supabase API activity, resetting the 7-day timer
- The `CRON_SECRET` env var prevents random people from hitting the endpoint

If the project ever does pause (e.g., you delete the cron), your data is safe.
Go to supabase.com → your project → click "Restore" and it's back in ~1 minute.

---

## Daily Usage

Once set up, you just use the tool normally:

- **Save / Save As / Open** — reads and writes to Supabase when signed in
- **⬇️ Export** — downloads current design as a .json file (works in both modes)
- **⬆️ Import** — loads a .json file into the editor (works in both modes)
- **Sign out** link at the bottom of the sidebar → back to login screen
- **"Skip — offline mode"** on login → uses localStorage, no account needed

The sidebar header shows your current mode:
- `☁️ you@email.com` = cloud sync active
- `💾 Local storage` = offline mode

---

## Free Tier Limits (You Won't Hit These)

### Supabase Free
- **500 MB database** — a floor plan design is ~2-5 KB of JSON. You'd need 100,000+ designs to matter.
- **50,000 monthly active users** — it's just you and Shannon
- **2 projects max** — this uses one
- **7-day inactivity pause** — handled by the heartbeat cron

### Vercel Hobby
- **1 cron job per day** — we use exactly one
- **100 cron jobs per project** — we use exactly one
- **Serverless function limits** — heartbeat runs <500ms, well within limits

---

## Troubleshooting

**Login screen doesn't appear / goes straight to localStorage mode**
→ Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in Vercel env vars. Redeploy after adding them.

**"Check your email for confirmation" but no email arrives**
→ Check spam/junk. Supabase sends from `noreply@mail.app.supabase.io`. If nothing after 5 minutes, try signing up again.

**Save fails with an error**
→ Check the browser console (F12). Most likely the `designs` table doesn't exist yet — re-run `supabase-setup.sql` in the SQL Editor.

**Heartbeat shows in Vercel logs but Supabase still paused**
→ The heartbeat query might be failing silently. Check Vercel Functions logs for error messages. Verify env vars are correct.

**Migration page shows 0 localStorage designs**
→ You need to open the migration page in the same browser where you previously used the tool. localStorage is per-browser, per-domain.

**Designs from one account visible to another**
→ This shouldn't happen. Row Level Security ensures isolation. If it does, re-run the RLS policies from `supabase-setup.sql`.
