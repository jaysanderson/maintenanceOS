import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";

const idParam = z.object({ id: z.string() });

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
    { schema: { tags: ["Notifications"], summary: "Mark notification read", params: idParam } },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParam>;
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
