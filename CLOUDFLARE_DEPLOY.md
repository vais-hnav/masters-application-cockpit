# Cloudflare Hosting And D1 Editing

This app is now set up for Cloudflare Pages + Pages Functions + D1.

## What Is Included

- Static frontend: `index.html`, `styles.css`, `app.js`
- Cloudflare API route: `functions/api/[[path]].js`
- D1 schema: `migrations/0001_init.sql`
- D1 seed data from the workbook: `seed.sql`
- Seed generator: `tools/build_seed_sql.py`
- Static build folder: `dist/`
- Cloudflare config: `wrangler.toml`
- Function routing: `_routes.json`

## First Deployment

Install Node.js first if `node` / `npm` are not available on your machine.

Use Git deployment or Wrangler for this project. Do not use the dashboard drag-and-drop upload, because Pages Functions are required for editing.

```bash
cd "/Users/vaishnav/Documents/masters planning data"
npm install
npx wrangler login
npm run db:create
```

Copy the `database_id` printed by Cloudflare into `wrangler.toml`, replacing:

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

Then create the tables and import the workbook data:

```bash
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

The deploy command builds `dist/` first, so Cloudflare only receives the public app files. The schema, seed file, and helper scripts are kept out of the hosted static assets.

## Local Cloudflare Dev

```bash
cd "/Users/vaishnav/Documents/masters planning data"
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open the local URL Wrangler prints, usually `http://localhost:8788`.

## Updating Data From Excel Later

When the Excel file changes:

```bash
npm run data:extract
npm run db:seed-file
npm run db:seed:remote
```

This resets the D1 data back to the latest workbook extract. Use it carefully because it replaces current rows.

## Editing Security

Best option: protect the whole deployed Pages app with Cloudflare Access.

1. Cloudflare Dashboard -> Zero Trust -> Access -> Applications.
2. Add a self-hosted application for your Pages hostname.
3. Allow only your email.
4. Redeploy or reopen the app.

The API accepts edits when Cloudflare Access sends the authenticated email header.

Fallback option: set an `EDIT_TOKEN` environment variable in Cloudflare Pages:

1. Cloudflare Dashboard -> Workers & Pages -> your Pages project.
2. Settings -> Environment variables.
3. Add `EDIT_TOKEN` as a secret value.
4. When the app asks for the edit token, paste it once. It is stored only in browser session storage.

For this deployment, an `EDIT_TOKEN` secret has already been created and a local copy is stored in `.edit-token`.
Use this command to view it:

```bash
cat .edit-token
```

## API Routes

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/programs?country=Germany`
- `PATCH /api/programs/:id`

`PATCH /api/programs/:id` accepts:

```json
{
  "bandKey": "waiting",
  "fields": {
    "university": "Example University",
    "course": "Computer Science"
  }
}
```

Every save writes to `programs` and also appends an audit row to `edit_history`.
