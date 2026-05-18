// CLI entry for `npm run db:seed` / `db:reset`.
// The actual seeding logic lives in seed-core.ts so it can be reused by the
// API (the demo "Reset" button) without spawning a process.
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-core.js";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
