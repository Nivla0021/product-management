# Product desk

A simple product manager: names, prices in Philippine pesos, and add/edit/delete. One admin password protects one shared list. The build-free frontend runs on GitHub Pages; a separate Neon Function stores data in your existing Neon Postgres database.

## Preview now

Install **Node.js 24 or later**, then run in this folder:

```powershell
node scripts/preview.mjs
```

Open **http://localhost:4173**. Until the API is configured, the page explains what to set up and disables unlocking. There is no fake database or browser-only persistence. To stop the preview, press Ctrl+C.

## Connect Neon when you are ready

No live Neon project has been changed. You will need access to your Neon account and the intended project, branch, and database. You do not need to send database passwords through chat.

### 1. Install and link

```powershell
npm.cmd ci
npx.cmd neon login
npx.cmd neon link
```

Select your **existing** project and intended branch/database. The link command writes ignored local Neon configuration and pulls environment values. Functions are currently supported in Singapore (`aws-ap-southeast-1`), Ohio (`aws-us-east-2`), Northern Virginia (`aws-us-east-1`), and Frankfurt (`aws-eu-central-1`). See the [Neon Functions quickstart](https://neon.com/docs/compute/functions/get-started).

For a safe first setup, select an isolated development branch of the existing project. Set up and verify there before repeating the SQL and function deployment on your intended production branch. Do not apply changes to an unrelated application's tables.

### 2. Create the product table

In the Neon Console SQL Editor, select the **same project, branch, and database** you linked. Run the contents of [`sql/setup.sql`](sql/setup.sql). It creates only `product_manager.products` and does not modify other schemas. Keep this SQL file in source control; rerunning it preserves existing products.

The table uses UUID IDs, names up to 160 characters, and `numeric(12,2)` prices. Names may repeat. Prices can range from ₱0.00 to ₱9,999,999,999.99. The API rejects more than two decimal places rather than rounding. Direct SQL writes must follow that rule too: PostgreSQL's numeric column rounds extra decimals supplied outside the API.

### 3. Set backend secrets

Use `.env.example` as a reference to create **`.env.local`**. If it already exists, preserve its pulled values. Set:

```dotenv
ADMIN_PASSWORD=your-long-random-admin-password
ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io,http://localhost:4173
```

Use a password-manager-generated password of at least 24 random characters. These values belong only in the ignored local env file and the Function deployment. `ALLOWED_ORIGINS` is comma-separated; an origin has no path or trailing slash, even when Pages uses a repository subpath. For a custom domain, add its exact HTTPS origin. Remove the localhost entry when you no longer need local access.

Neon injects the deployed Function's `DATABASE_URL` for the linked branch. Do not put a connection string into `neon.ts` or `docs/`. The example connection string is only a placeholder; local development requires the actual pooled URL pulled by Neon. See [Function environment variables](https://neon.com/docs/compute/functions/environment-variables).

### 4. Deploy the API

```powershell
npm.cmd run api:deploy
npx.cmd neon functions get products
```

Copy the returned **`invocation_url`** into [`docs/config.js`](docs/config.js):

```javascript
window.APP_CONFIG = { apiUrl: "https://YOUR-NEON-FUNCTION-URL/" };
```

Use the actual URL Neon returns, not the example. This is public configuration; **never add the admin password, database URL, or Neon API key here**. For local backend development after linking and configuring env, run `npm.cmd run api:dev`; point `docs/config.js` at the URL printed by Neon. Only loopback HTTP URLs are accepted; deployed URLs require HTTPS.

## Publish on GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch. Include `package-lock.json`; exclude `.env.local`, `.neon`, and `node_modules` (already ignored).
2. In the repository, go to **Settings → Pages → Build and deployment**.
3. Choose **Deploy from a branch**, branch **main**, folder **/docs**, then **Save**.
4. Open the published URL, normally `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.
5. Unlock using the backend admin password. Add a product, reload the page, unlock again, and confirm it persists. Verify editing and deletion too.

There is no frontend build step or GitHub Actions workflow to maintain. GitHub Pages serves only `docs/`; the database and API remain on Neon. Changes pushed to `main` update the frontend. Backend changes require another `npm.cmd run api:deploy`.

## API

All product endpoints require `Authorization: Bearer <ADMIN_PASSWORD>`. JSON writes use price **strings** so decimal precision is preserved.

| Method | Path            | Request                                   | Success                                                                   |
| ------ | --------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/products`     | —                                         | `{ "products": [{ "id": "UUID", "name": "Coffee", "price": "150.25" }] }` |
| POST   | `/products`     | `{ "name": "Coffee", "price": "150.25" }` | 201, `{ "product": { ... } }`                                             |
| PUT    | `/products/:id` | Same as POST                              | `{ "product": { ... } }`                                                  |
| DELETE | `/products/:id` | —                                         | 204, no body                                                              |

Errors return `{ "error": "message" }`: 400 invalid input, 401 incorrect password, 403 disallowed browser origin, 404 missing product/endpoint, 405 unsupported method, or 503 missing configuration/database unavailable. CORS preflight does not require a password; actual operations always do. CORS is a browser restriction, not authentication.

## Checks

```powershell
npm.cmd test
```

Tests use Node's built-in runner and an injected database query function: no live credentials or test database are required. They cover authorization, CORS, exact decimal validation, parameterized CRUD, malformed requests, missing products, and safe database errors.

Frontend event tests also cover unlocking, CRUD, literal rendering of product names, failed saves retaining input, canceled deletions, locking, and network errors. These use a small DOM test double, not a real browser. Desktop/mobile visual verification remains pending: Computer Use could not verify the current browser URL and stopped browser testing.

Dependency verification: `npm audit --omit=dev` reported zero production advisories. The installed Neon CLI has seven development dependency advisories (six moderate, one low). These are confined to local CLI tooling, not the deployed API or static frontend. Recheck when updating the CLI; do not use `npm audit fix --force`, which currently proposes downgrading to an older CLI without the required Functions workflow.

Before going live, verify against your connected database: unlock; add a product; edit; cancel a deletion; confirm a deletion; reload and unlock; check a phone-width view. If the database/API is unavailable, failed saves retain form values and failed deletes retain rows.

The admin password stays in tab memory and is cleared on lock or reload. There are no accounts, password recovery, inventory, categories, or images. Anyone with the admin password has full access. This small personal tool uses a high-entropy shared password rather than a user authentication service; it does not provide account lockouts or a global rate limiter. Rotate the password by changing `.env.local` and redeploying the Function. Live persistence and deployment cannot be verified until you connect Neon.
