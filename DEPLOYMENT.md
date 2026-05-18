# MaintenanceOS — Deployment & Persistence

## Local / demo (default)

SQLite (`apps/api/prisma/dev.db`). Zero setup. Back it up from
**Settings → Backups** (Admin/Manager) or `POST /api/system/backup`; copies land
in `apps/api/backups/`. Restore by stopping the API and replacing
`prisma/dev.db` with a backup file.

## Production persistence — move to PostgreSQL

SQLite is single-writer and the container filesystem is ephemeral on most PaaS.
For production, switch to managed Postgres (no app code changes — Prisma
abstracts it):

1. Provision managed Postgres (Neon / Render / Fly / RDS).
2. `apps/api/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set `DATABASE_URL` to the Postgres connection string (host env var, not
   committed).
4. `npx prisma migrate deploy` (use migrations rather than `db push` in prod).
5. Seed once if desired: `npm run db:seed`.
6. Use the provider's **automated backups / PITR**; the in-app backup endpoint
   is for the SQLite demo only.

## Required environment variables (production)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Strong random secret (sessions) |
| `CORS_ORIGIN` | Comma-separated allowed web origins |
| `RATE_LIMIT_MAX` | Requests/min/IP (default 300) |
| `NODE_ENV=production` | Tighter CORS default |

## Hosting

Single tiny instance is enough (see earlier cost analysis): serve the built
`apps/web/dist` as static assets and run the API as one process. Render / Fly /
a small VPS all work. Health check: `GET /health`.

## Email

Notifications are recorded in `EmailOutbox` (logged, not sent) for the demo. To
send for real, plug an SMTP transport (e.g. nodemailer) into
`apps/api/src/lib/notify.ts` keyed off an `EMAIL_SMTP_URL` env var.
