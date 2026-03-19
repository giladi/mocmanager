# LEGO MOC Manager Starter v2

This version adds:
- Rebrickable CSV importer
- Import preview before saving
- MOC title override before import
- Optional MOC URL before import
- Spare-row skipping

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Then fill in your Supabase values in `.env`.

## Supabase

1. Create a Supabase project
2. Open SQL Editor
3. Run `supabase/schema.sql`
4. Enable Email auth
5. Copy your project URL and anon key into `.env`

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`

Environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Current status

Included:
- Auth
- Dashboard
- Manual MOC creation
- Manual part editing
- Rebrickable CSV import preview

Next:
- Grouped buy list
- Image fallback logic
- Per-MOC arrival tracking inside grouped buy list


## v4 improvements

- Search resets when switching MOCs
- Sort by part, color, need, have, missing, ordered, arrived, completed
- New To Order stage in Buy List
- Cleaner aligned MOC lines in Buy List
