# LEGO MOC Manager Starter

This is a starter version of your LEGO MOC Manager rebuilt as a real web app:

- React frontend
- Supabase database + auth
- Ready to deploy on Cloudflare Pages

## 1. Create the app locally

```bash
npm install
cp .env.example .env
npm run dev
```

Then fill in your Supabase values in `.env`.

## 2. Create a Supabase project

In Supabase:
- create a new project
- open SQL Editor
- run `supabase/schema.sql`
- in Authentication, enable Email login
- copy your project URL and anon key into `.env`

## 3. Database tables

This starter uses:
- `mocs`
- `moc_parts`

The schema also enables Row Level Security so each signed-in user only sees their own data.

## 4. Auth

This starter uses password auth with email + password.
You can switch to magic links later if you prefer.

## 5. Deploy to Cloudflare Pages

### Option A: Git-based deploy
- push this project to GitHub
- create a Cloudflare Pages project
- connect the repo
- build command: `npm run build`
- build output directory: `dist`
- set environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

### Option B: direct upload
```bash
npm run build
```
Then upload the `dist` folder to Cloudflare Pages.

## 6. What is included

- Dashboard of MOCs
- Create MOC form
- Per-MOC parts page
- Add / edit / delete parts
- Ordered / arrived / completed tracking
- Buy list grouped by part + color

## 7. What is not included yet

- CSV importer from Rebrickable
- Image fallback search logic
- Manual image overrides
- Advanced grouped buy-list actions
- Multi-user collaboration

## 8. Recommended next step

After you confirm this starter works with Supabase auth and DB:
- add the CSV importer
- add grouped buy-list export
- add image fallback logic back in
