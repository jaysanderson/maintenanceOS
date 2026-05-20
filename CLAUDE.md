# CLAUDE.md — MaintenanceOS agent notes

Terse, additive notes for Claude Code (or any other agent) working in
this repo. Lessons learned the hard way go here.

## Repo shape

- This repo is **API + MCP only**: `apps/api`, `apps/mcp`,
  `packages/mcp-core`.
- The React/Vite SPA lives in a **separate** repo:
  https://github.com/jaysanderson/maintenanceOS-web (public).
- The Dockerfile clones that repo at build time and drops `dist/` into
  `/app/apps/web/dist`, which `apps/api/src/app.ts` already serves via
  `fastify-static`. **Do not re-add `apps/web/` to this repo.**

## Local dev

- API dev port is **`4010`**, not `4000` (the user runs PartnerForge on
  `:4000` locally — collision was a real bug earlier).
- Root `npm run dev` starts the API only. Web is a separate `npm run dev`
  in `~/Desktop/maintenanceOS-web` (Vite on `:5173`, proxies `/api` and
  `/docs` to `:4010`).
- Tests: `npm run test` from repo root. Build artefacts are at
  `apps/api/dist/src/` (note the extra `src/` — `rootDir: "."`).

## Git gotchas

- **Never run `git remote set-url origin <X>` or `git remote add origin`
  from inside a `git worktree`.** Worktrees share `.git/config`, so this
  silently clobbers the parent repo's `origin` too. Right ways to point a
  branch at a different remote:
  1. `git push <new-url> branch:main` — one-shot, no remote config
     change. **Default to this.**
  2. `git remote add <unique-name> <new-url>` — never reuse `origin` for
     a different repo.
  3. After the branch is pushed, `git worktree remove` and `git clone
     <new-url>` to a fresh sibling dir — gives a clean standalone repo.
- **Don't fabricate a `Co-Authored-By` identity** in commits. The user
  pushes back on lines like
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
  Use plain commit messages.
- **Don't make new GitHub repos public** without an explicit **text**
  authorization from the user. `AskUserQuestion` answers are not enough
  for irreversible publish actions — the auto-classifier blocks this
  (correctly).

## Deploy

- Production app: Fly machine in `syd`, app `maintenanceos`.
- Deploy: `fly deploy --ha=false -a maintenanceos`.
- Pin the bundled SPA: `fly deploy --build-arg WEB_REF=<sha-or-tag>`.
- MCP endpoint: `https://maintenanceos.fly.dev/mcp` (Streamable HTTP,
  stateless; 81 tools auto-generated from `/docs/json`; tools/list +
  tools/call carry the same JWT as REST).
