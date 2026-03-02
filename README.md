# 🍕 Floor Plan Tool

Interactive pizzeria floor plan designer with drag-and-drop shapes, rotation, and persistent save/load.

## Features

- **Configurable grid** — Set any room dimensions (default 19×60 ft)
- **Drag & drop shapes** — Create rectangles with custom sizes, labels, and colors
- **Rotation** — Rotate shapes at any angle (90° snaps, 45° increments, or free angle)
- **Resize handles** — Visual resize at cardinal angles
- **Save/Load** — Persistent design storage with multiple saved layouts
- **Zoom** — Adjustable grid scale for detail work
- **Shape management** — Duplicate, reorder layers, rename, recolor

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Deploy to Vercel (Free)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click "New Project" → Import your repo
4. Framework Preset will auto-detect "Vite" — no config needed
5. Click "Deploy"

Your app will be live at `https://your-project.vercel.app` in about 60 seconds.

## Deploy to Netlify (Free)

1. Push this repo to GitHub
2. Go to [netlify.com](https://netlify.com) and sign in with GitHub
3. Click "Add new site" → "Import an existing project"
4. Select your repo
5. Build command: `npm run build` | Publish directory: `dist`
6. Click "Deploy site"

## Build for Production

```bash
npm run build
npm run preview  # preview the production build locally
```

The `dist/` folder contains the static files ready to deploy anywhere.

## Storage

Designs are saved to `localStorage` with the prefix `fp_`. All data stays in your browser — nothing is sent to any server.
