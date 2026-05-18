import type { FastifyInstance } from "fastify";
import { createWriteStream, createReadStream, existsSync } from "node:fs";
import { unlink, mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.js";
import { notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";

const UPLOAD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads"
);

function kindFor(mime: string): string {
  if (mime.startsWith("image/")) return "PHOTO";
  return "DOCUMENT";
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.post(
    "/work-orders/:id/attachments",
    { schema: { tags: ["Attachments"], summary: "Upload a file to a work order" } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const wo = await prisma.workOrder.findUnique({ where: { id } });
      if (!wo) throw notFound("Work order");

      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      await mkdir(UPLOAD_DIR, { recursive: true });
      const storedName = `${randomUUID()}-${file.filename}`;
      const dest = join(UPLOAD_DIR, storedName);
      await pipeline(file.file, createWriteStream(dest));

      if (file.file.truncated) {
        await unlink(dest).catch(() => {});
        return reply.status(413).send({ error: "File too large (max 10MB)" });
      }

      const att = await prisma.attachment.create({
        data: {
          workOrderId: id,
          filename: file.filename,
          storedName,
          mimeType: file.mimetype,
          size: 0,
          kind: kindFor(file.mimetype),
          uploadedByEmail: req.authUser?.email ?? null,
        },
      });
      await audit(req.authUser, {
        action: "ATTACHMENT_UPLOAD",
        entity: "WorkOrder",
        entityId: id,
        summary: `${wo.workOrderNumber}: uploaded ${file.filename}`,
      });
      reply.status(201);
      return att;
    }
  );

  app.get(
    "/work-orders/:id/attachments",
    { schema: { tags: ["Attachments"], summary: "List work order attachments" } },
    async (req) => {
      const { id } = req.params as { id: string };
      return prisma.attachment.findMany({
        where: { workOrderId: id },
        orderBy: { createdAt: "desc" },
      });
    }
  );

  app.get(
    "/attachments/:attId/download",
    { schema: { tags: ["Attachments"], summary: "Download an attachment" } },
    async (req, reply) => {
      const { attId } = req.params as { attId: string };
      const att = await prisma.attachment.findUnique({ where: { id: attId } });
      if (!att) throw notFound("Attachment");
      const path = join(UPLOAD_DIR, att.storedName);
      if (!existsSync(path)) throw notFound("File");
      reply.header("Content-Type", att.mimeType);
      reply.header(
        "Content-Disposition",
        `inline; filename="${att.filename}"`
      );
      return reply.send(createReadStream(path));
    }
  );

  app.delete(
    "/attachments/:attId",
    { schema: { tags: ["Attachments"], summary: "Delete an attachment" } },
    async (req, reply) => {
      const { attId } = req.params as { attId: string };
      const att = await prisma.attachment.findUnique({ where: { id: attId } });
      if (!att) throw notFound("Attachment");
      await unlink(join(UPLOAD_DIR, att.storedName)).catch(() => {});
      await prisma.attachment.delete({ where: { id: attId } });
      await audit(req.authUser, {
        action: "ATTACHMENT_DELETE",
        entity: "Attachment",
        entityId: attId,
        summary: `Deleted attachment ${att.filename}`,
      });
      reply.status(204);
      return null;
    }
  );
}
