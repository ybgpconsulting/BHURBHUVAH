# Milk Delivery Management System

A complete, production-ready web application for managing an Indian milk subscription and doorstep delivery business, built on **React + TypeScript + Tailwind CSS + Cloudflare Workers + Cloudflare D1 SQL**.

---

## Architecture & Features

- **Main Dashboard**: Date-filtered metrics (`Asia/Kolkata` timezone) for scheduled vs. completed deliveries, milk volumes in litres, customer status metrics, operations summary, and interactive charts (`Recharts`).
- **Customer Management**: Full CRUD, search by name/phone/code/area, route & delivery partner assignment, and historical tabs for subscriptions, deliveries, and changes.
- **Products & Plan Templates**: Configurable products (e.g., A2 Cow Milk, A2 Buffalo Milk) with fractional quantity support, plus configurable Fixed-Day (1-day, 3-day, 10-day) and Calendar-Month plans.
- **Subscriptions & Dated Delivery Changes**: Automatic end-date calculation, multi-item subscriptions, and effective-dated customer changes (Single-day skip, Pause date range, Quantity change, Product change, One-time addition, Address/Route change).
- **Scheduled Daily Dispatch**: Cloudflare Cron runs daily at 20:00 Asia/Kolkata (14:30 UTC) and creates the next day's dispatch as a draft. Generation is idempotent, uses the same business rules as manual generation, records each attempt, and exposes failed attempts for safe retries. Publishing is a separate reviewed action.
- **Mobile Delivery Partner Portal**: Dedicated mobile-first interface (`/deliveries`) where delivery partners see only their assigned stops, contact customers, open Google Maps directions, and record completed, partial, or missed deliveries with mandatory exception reasons.
- **Plan Expiry & Follow-Up Centre**: Automatic tracking of plans expiring today, tomorrow, within 3/7 days, or already expired, with follow-up workflow tracking, one-click renewal, and WhatsApp click-to-chat integration.
- **Security & RBAC**: PBKDF2-SHA256 password hashing via Web Crypto API, HMAC-protected session IDs, HTTP-only session cookies, login rate limiting, same-origin mutation checks, and server-side role-based access control (`owner`, `manager`, `delivery_partner`).

---

## Local Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Apply Database Migrations Locally
```bash
npm run db:migrate:local
```

### 3. (Optional) Load Development Seed Data
> **Note**: Seed data is for development/demonstration only.
```bash
npm run db:seed
```

### 4. Start the Local Servers
Run the Cloudflare Worker + D1 backend on port `8787`:
```bash
npx wrangler dev --local --port 8787
```
In a second terminal, run the Vite React frontend dev server (which proxies `/api` to `localhost:8787`):
```bash
npm run dev
```
 To initialize your first Owner account on a clean database, navigate to `/setup` in the browser.

---

## Testing & Verification

Run the automated test suite (business rules, export reconciliation, Worker API, and isolated local D1 scheduled-handler integration tests):
```bash
npm run test
```

Run TypeScript type checking and production bundle build:
```bash
npx tsc --noEmit
npm run build
```

The integration test suite creates a disposable Miniflare D1 database and does not use test sessions or demo accounts against any production database.

## Staging Setup (No Production Resources)

1. Create a dedicated staging D1 database in the intended Cloudflare account:
   ```bash
   npx wrangler login
   npx wrangler d1 create milk-delivery-staging-db
   ```
2. Copy only the returned staging UUID into `wrangler.toml` at `[env.staging.d1_databases]`. Do not copy a production database ID. The staging environment has its own Worker name, D1 binding, `APP_ENV = "staging"`, and the same verified 20:00 Asia/Kolkata cron.
3. Store a random secret of at least 32 bytes in the team's secret manager, then set it as a Cloudflare secret (never in `wrangler.toml` or `.env` committed to source control):
   ```bash
   npx wrangler secret put SESSION_SECRET --env staging
   ```
4. Apply migrations only to the staging database:
   ```bash
   npx wrangler d1 migrations apply milk-delivery-staging-db --remote --env staging
   ```
5. Build and verify the deployment bundle without publishing a Worker:
   ```bash
   npm ci
   npm test
   npm run typecheck
   npm run lint
   npm run build
   npm run deploy:dry-run
   ```
   The dry-run is deliberately blocked until the staging D1 UUID is configured. It does not target production. A real staging release, when approved, is `npx wrangler deploy --env staging`.
6. Open the staging Worker URL, complete `/setup` once using a staging-only owner credential, and test customer/subscription create/edit, dated changes, scheduled draft generation, review/publish, partner isolation, delivery recording, follow-up renewal, and master plus route-specific Excel/PDF exports with synthetic records only.
7. Before migrations or release, export a staging backup and verify restore into a separate disposable D1 database. Never test recovery against production. Retain the backup and restoration notes outside the application.
   ```bash
   npx wrangler d1 export milk-delivery-staging-db --remote --env staging --output C:\secure-backups\milk-delivery-staging.sql
   npx wrangler d1 create milk-delivery-restore-check
   npx wrangler d1 execute milk-delivery-restore-check --remote --file C:\secure-backups\milk-delivery-staging.sql
   ```
   Verify the restored schema and representative synthetic staging rows using read-only SQL, then remove only the specifically named restore-check database after approval.

To exercise the scheduled handler with Wrangler locally, in one terminal run:
```bash
npx wrangler dev --local --test-scheduled --port 8787
```
Then trigger the configured scheduled event from another terminal:
```bash
curl "http://127.0.0.1:8787/__scheduled?cron=30+14+*+*+*"
```
Wrangler calls the Worker `scheduled()` entry point. The generated date is calculated from the scheduled event instant in Asia/Kolkata, not the machine timezone. Local demo data is optional and must only be seeded into the local D1 database.

---

## Production Deployment (Cloudflare Workers + D1)

The production Worker uses a separate D1 binding. The checked-in production database ID is deliberately invalid; `npm run deploy` refuses to proceed until a real production UUID has been deliberately configured. Do not reuse the local placeholder or seed data in production.

1. **Back up the existing production D1 database** before any migration. Keep the backup outside the application and verify that it can be restored to a staging database. Do not run destructive migrations without a reviewed backup and recovery plan.
2. **Authenticate Wrangler**:
   ```bash
   npx wrangler login
   ```
3. **Provision and record the production D1 database** (only after explicit authorization):
   ```bash
   npx wrangler d1 create milk-delivery-db
   ```
   Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]`.
4. **Set the production SESSION_SECRET as a Cloudflare secret**; never add it to `wrangler.toml` or source control:
   ```bash
   npx wrangler secret put SESSION_SECRET --env production
   ```
5. **Apply additive migrations to staging first**, validate the application, and then apply them to production during an approved maintenance window:
   ```bash
   npx wrangler d1 migrations apply milk-delivery-production-db --remote --env production
   ```
6. **Configure the scheduled generation time**. Default is 20:00 Asia/Kolkata, equivalent to `30 14 * * *` UTC. If changing `DISPATCH_GENERATION_TIME`, also change the corresponding Cron expression in both the default and production `[triggers]` configuration using local time minus 5 hours 30 minutes. Confirm the resulting UTC time before release.
7. **Build and deploy the production environment**:
   ```bash
   npm run build
   npm run deploy
   ```
8. Confirm the Worker health, migrations, login, draft generation, dispatch review/publish, partner assignment isolation, scheduled execution logs, and backup monitoring in staging before promoting the release.

Cloudflare logs are the production log sink. Scheduled failures are saved in `dispatch_generation_runs`, displayed in the owner dashboard/dispatch page, and can be safely retried by an authorized owner or manager. A notification-provider interface can be attached to publication; no email, push, or WhatsApp provider is configured by this repository. The existing WhatsApp click-to-chat link is user-initiated and is not an automated dispatch notification.

Dispatch notifications can be integrated by implementing `DispatchNotificationProvider` in `src/server/dispatch-notifications.ts` and injecting it into the publish workflow. Until one is configured, portal publication is the delivery-partner distribution mechanism.
