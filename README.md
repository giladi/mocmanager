# LEGO MOC Manager Starter v3

This version adds:

- Rebrickable CSV importer
- Import preview before saving
- fixed import modal so the action buttons stay visible
- part images with BrickLink image attempts
- fallback links to Brick Owl / Rebrickable
- hosted grouped buy list
- per-MOC arrival tracking inside the grouped buy list

## Setup

npm install
copy .env.example to .env
npm run dev

Then fill in your Supabase values in .env.

## Supabase

1. Create a Supabase project
2. Open SQL Editor
3. Run supabase/schema.sql
4. Enable Email auth
5. Copy your project URL and anon key into .env

## Cloudflare Pages

- Build command: npm run build
- Output directory: dist

Environment variables:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
