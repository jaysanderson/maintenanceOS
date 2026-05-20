# Single-process image: Fastify serves the API + the built React SPA.
# SQLite is created & seeded at build time (disposable demo data; resets on
# every deploy — matches the chosen demo setup). Upgrade path (Postgres +
# volume) is in DEPLOYMENT.md.
#
# The web SPA now lives in its own repo (https://github.com/jaysanderson/maintenanceOS-web).
# This Dockerfile clones + builds it during image build, then drops the
# `dist/` output where apps/api/src/app.ts already expects to find it
# (apps/web/dist, resolved relative to the compiled api app.js). Pin to a
# specific web build with `--build-arg WEB_REF=<tag-or-sha>`.
FROM node:20-bookworm-slim

# Prisma needs openssl at build and runtime; git is needed to clone the
# external web repo during the build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the monorepo (.dockerignore keeps node_modules/dist/db/uploads out).
COPY . .

# SQLite path is resolved relative to apps/api/prisma/schema.prisma.
ENV DATABASE_URL="file:./dev.db"

# Web SPA — external repo. Public, so no auth needed. Override either of
# these build args to point at a fork or pin to a specific commit/tag.
ARG WEB_REPO_URL=https://github.com/jaysanderson/maintenanceOS-web.git
ARG WEB_REF=main

# Clone + build the web frontend, then drop dist/ where the API expects it.
RUN git clone --depth=1 --branch "${WEB_REF}" "${WEB_REPO_URL}" /tmp/web \
 && (cd /tmp/web && npm install && npm run build) \
 && mkdir -p /app/apps/web \
 && mv /tmp/web/dist /app/apps/web/dist \
 && rm -rf /tmp/web

# Install API + mcp + mcp-core deps, generate Prisma client, build the
# remaining workspaces, then create and seed the SQLite database into the
# image. NODE_ENV is intentionally NOT set yet so dev deps install.
RUN npm install \
 && npm run db:generate --workspace apps/api \
 && npm run build \
 && npm run db:push --workspace apps/api \
 && npm run db:seed --workspace apps/api

# Runtime-only settings (after the build so dev deps were available above).
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "apps/api"]
