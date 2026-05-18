# Single-process image: Fastify serves the API + the built React SPA.
# SQLite is created & seeded at build time (disposable demo data; resets on
# every deploy — matches the chosen demo setup). Upgrade path (Postgres +
# volume) is in DEPLOYMENT.md.
FROM node:20-bookworm-slim

# Prisma needs openssl at build and runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the monorepo (.dockerignore keeps node_modules/dist/db/uploads out).
COPY . .

# SQLite path is resolved relative to apps/api/prisma/schema.prisma.
ENV DATABASE_URL="file:./dev.db"

# Install ALL deps (dev deps needed for the build), generate the Prisma
# client, build api + web, then create and seed the SQLite database into
# the image. NODE_ENV is intentionally NOT set yet so dev deps install.
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
