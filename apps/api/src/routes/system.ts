import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { requireRole } from "../auth-guard.js";
import { ADMIN_ROLES } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { seedDatabase } from "../../prisma/seed-core.js";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DB_PATH = join(apiRoot, "prisma", "dev.db");
const BACKUP_DIR = join(apiRoot, "backups");

/**
 * Demo + ops controls.
 * - reset: wipe + re-seed (Admin/Manager, confirm required).
 * - backup/backups: snapshot the SQLite file (Admin/Manager). For production
 *   move DATABASE_URL to Postgres (Prisma provider swap) and use managed
 *   automated backups — see DEPLOYMENT.md.
 */
export async function systemRoutes(app: FastifyInstance) {
  app.post(
    "/reset",
    {
      schema: { tags: ["System"], summary: "Reset demo data (Admin/Manager)" },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async (req) => {
      parse(z.object({ confirm: z.literal(true) }), req.body);
      const counts = await seedDatabase(prisma);
      await audit(req.authUser, {
        action: "DEMO_RESET",
        summary: `${req.authUser.email} reset the demo environment`,
        meta: counts,
      });
      return { ok: true, counts };
    }
  );

  app.post(
    "/backup",
    {
      schema: { tags: ["System"], summary: "Create a database backup (Admin/Manager)" },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async (req) => {
      await mkdir(BACKUP_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `dev-${ts}.db`;
      await copyFile(DB_PATH, join(BACKUP_DIR, name));
      await audit(req.authUser, {
        action: "DB_BACKUP",
        summary: `${req.authUser.email} created backup ${name}`,
      });
      return { ok: true, file: name };
    }
  );

  app.get(
    "/backups",
    {
      schema: { tags: ["System"], summary: "List database backups (Admin/Manager)" },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async () => {
      await mkdir(BACKUP_DIR, { recursive: true });
      const files = (await readdir(BACKUP_DIR)).filter((f) =>
        f.endsWith(".db")
      );
      const out = [];
      for (const f of files) {
        const s = await stat(join(BACKUP_DIR, f));
        out.push({ file: f, size: s.size, createdAt: s.mtime });
      }
      return out.sort((a, b) => +b.createdAt - +a.createdAt);
    }
  );
}
