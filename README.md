# MaintenanceOS

An API-first ERP / operations platform for a mid-sized property maintenance business.

Core flow: **Account → Site → Work Order → Quote → Approval → Schedule → Technician Assignment → Job Completion → Invoice → Job Margin**

## Stack

- **Monorepo**: npm workspaces
- **API** (`apps/api`): Node.js, TypeScript, Fastify, Prisma, SQLite, Zod, Swagger/OpenAPI
- **Web** (`apps/web`): React, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query

The frontend **never** talks to the database directly — all data and business logic go through the API.

## Quick start

```bash
npm install                 # install all workspace deps
npm run db:reset            # create SQLite db + apply schema + seed
npm run dev                 # run API (http://localhost:4000) + Web (http://localhost:5173)
```

- API base: `http://localhost:4000/api`
- Swagger docs: `http://localhost:4000/docs`
- Web app: `http://localhost:5173`

## Useful commands

| Command | Description |
|---|---|
| `npm run db:reset` | Drop, recreate and seed the database |
| `npm run db:seed` | Re-seed only |
| `npm run dev` | Run API + Web together |
| `npm run build` | Build both apps |
| `npm run typecheck` | Typecheck both apps |

## Project layout

```
apps/
  api/   Fastify API, Prisma schema, seed, domain logic
  web/   React SPA, only consumes the API
```
