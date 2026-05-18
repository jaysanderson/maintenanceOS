import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { schema: { tags: ["Notifications"], summary: "List notifications" } },
    async () => {
      const [items, unread] = await Promise.all([
        prisma.notification.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        prisma.notification.count({ where: { read: false } }),
      ]);
      return { items, unread };
    }
  );

  app.post(
    "/:id/read",
    { schema: { tags: ["Notifications"], summary: "Mark notification read" } },
    async (req) => {
      const { id } = req.params as { id: string };
      await prisma.notification.updateMany({
        where: { id },
        data: { read: true },
      });
      return { ok: true };
    }
  );

  app.post(
    "/read-all",
    { schema: { tags: ["Notifications"], summary: "Mark all read" } },
    async () => {
      await prisma.notification.updateMany({
        where: { read: false },
        data: { read: true },
      });
      return { ok: true };
    }
  );
}
