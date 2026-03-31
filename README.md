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
- `REBRICKABLE_API_KEY`
- `BRICKOWL_API_TOKEN`

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


## v5 combined improvements

- Direct button in Ordered buy list to move a line back to To Order
- MOC line names in Buy List link back into the MOC page
- To Order can be filtered by MOC while still showing extra shared quantity from other MOCs
- Browser tab favicon added

- Bulk actions per grouped part in Buy List: Order all, Clear all, Mark all arrived, Back all to To Order


## Sprint 1 - Orders

- Real orders as objects
- Vendor, date, tracking, notes, status
- Assign ordered MOC lines into orders
- Edit and delete orders


## Sprint 1 polish

- Assign to orders directly in Buy List
- Multi-select ordered lines and bulk-add to order
- Orders page changed from giant line dump to summary cards + order details modal


## v9 refinement

- Ordered now supports Select all visible
- Bulk assign selected ordered lines to an order
- Clear visible selection


## v10 modal polish

- Order details modal now scrolls internally
- Header and Close button stay visible


## Sprint 1.2 polish

- Order cards now show summary metrics
- Order details supports multi-select bulk actions
- Arrived/pending management inside order details
- Completion hint when all assigned lines arrived


## v12 hotfix

- Fix startup crash caused by metricsByOrderId referencing orderedRows before initialization


## Sprint 2 - Arrival & sourcing

- Per-order-line ordered qty and arrived qty
- Multi-stage sourcing status: ordered, in transit, partial arrived, arrived, cancelled, substituted
- Vendor SKU / reference per line
- Substitution / cancellation notes per line
- Order metrics now use order-line arrival quantities


## v14 hotfix

- Clears stale deleted order from bulk picker automatically
- Prevents assigning to a deleted/nonexistent order
- Shows a clear error message instead of failing silently


## v15 display hotfix

- Fix Buy List order assignment display after Sprint 2 data-model changes
- UI now reads orderId/orderName correctly from ordersByPartId


## Sprint 2 wrap-up

- Quantities now drive default arrival status
- Cancelled/substituted count as resolved, not pending
- Order summaries include resolved qty and all-resolved hint
- Line editing better syncs status and quantities


## v17 scroll controls

- Added floating Top and Bottom buttons for long pages like Buy List


## Sprint 3.1

- MOC build status
- MOC priority
- Dashboard filtering and sorting
- Per-MOC planning metrics and progress


## Sprint 3.2

- Dashboard progress bars
- Stronger status/priority visual badges
- Quick status and priority editing from each MOC card
- Better MOC card scanning and sorting behavior


## Sprint 4.1

- Per-part notes on MOC lines
- Inline note editing in parts tables
- Notes visible in Buy List and Order Details where relevant


## Sprint 4.2

- Global search across all MOCs
- Search by part number, color, MOC name, and notes
- Search results can jump directly into the matching MOC


## v22 search hotfix

- Fix Search button routing so it opens the global search view


## v23 search render fix

- Fixed top-level render logic so Search view is shown before Dashboard


## Sprint 4.3

- Part-level duplicate/substitute logic
- Modes: exact, substitute allowed, substituted
- Substitute notes visible across parts, buy list, orders, and search
- Substituted lines treated as resolved in MOC planning views


## Sprint 5.1

- CSV export for the selected MOC parts
- CSV export for grouped Buy List views
- CSV export for the currently viewed Order details


## Sprint 5.2

- Saved views / filters
- Save current view state
- Load saved views
- Delete saved views


## v27 saved view hotfix

- Fix applying saved views so the app switches to the saved screen type correctly


## v28 nav hotfix

- Added a shared openView helper for top-nav and saved views
- Saved views now use the same screen-switching path as manual navigation


## Sprint 5.3

- Visual polish across panels, tables, cards, and badges
- Improved part image framing and fallback presentation
- Compact and comfortable density modes
- Cleaner empty states and section guidance


## v30 header polish

- Removed sprint subtitle from the app header
- Reworked top navigation and actions into grouped header controls
- Improved overall header layout for a more GA-like presentation


## v31 layout alignment

- Align header and saved views panel width with the main content area
- Fix top-section container width mismatch


## v32 layout overflow fix

- Constrained the dashboard grid to prevent the lower content area from stretching wider than the header
- Main content column now uses minmax(0, 1fr) to avoid overflow


## v33 guide page

- Added a dedicated Guide page
- Explains the main workflow, pages, and core concepts
- Added Guide button to the top navigation


## v34 color mapping update

- Rebrickable import mapping updated:
  - 9999 -> Any Color
  - 297 -> Pearl Gold
  - 80 -> Metallic Silver
  - 82 -> Metallic Gold


## v35 Rebrickable image fallback

- Added Rebrickable API fallback for missing part images
- Uses environment variable `VITE_REBRICKABLE_API_KEY`
- BrickLink remains the first image source; Rebrickable is used when BrickLink images fail


## v36 default sort color

- Default part-table sorting changed from part number to color


## v37 image cache

- Added in-memory caching for resolved Rebrickable fallback image URLs
- Added miss-cache to avoid repeated failed lookups
- Added loading state while fallback image is being fetched
- Improves reliability of missing-image fallback without repeated refreshes


## v38 Rebrickable proxy

- Replaced direct browser calls to Rebrickable with a Cloudflare Pages Function proxy at `/api/rebrickable-image`
- Uses Cloudflare environment variable `REBRICKABLE_API_KEY`
- Fixes CORS issues and avoids exposing the API key in frontend code
- Guide page updated to reflect the new image fallback architecture


## v39 Any Color image override

- Parts with color `Any Color` now use a blue reference image for thumbnail resolution
- This is image-only behavior and does not change stored color data, grouping, exports, or search
- Guide page updated to explain the blue reference image behavior


## v44 image fallback hardening

- Rebuilt on top of the v41 project structure without flattening the app
- Rebrickable proxy fallback order is now exact color -> generic part ref -> blue ref
- Added optional Brick Owl server-side reference fallback using `BRICKOWL_API_TOKEN`
- Added thumbnail badges for `Part ref`, `Blue ref`, and `Owl ref`
- Guide page updated to explain the new image-source behavior
