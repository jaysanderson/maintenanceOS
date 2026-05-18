import { prisma } from "../prisma.js";

export interface NotifyInput {
  type: string;
  message: string;
  entity?: string;
  entityId?: string;
  email?: { to: string; subject: string; body: string };
}

/**
 * Raise an in-app notification and (optionally) queue an email.
 *
 * Email is recorded in EmailOutbox rather than sent — a real SMTP transport
 * (e.g. nodemailer) can be plugged in here later by reading EMAIL_SMTP_URL.
 * Best-effort: notification failures must not break business operations.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: input.type,
        message: input.message,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
      },
    });
    if (input.email) {
      await prisma.emailOutbox.create({
        data: {
          to: input.email.to,
          subject: input.email.subject,
          body: input.email.body,
          status: "LOGGED",
        },
      });
      console.log(
        `[email-outbox] → ${input.email.to}: ${input.email.subject}`
      );
    }
  } catch (err) {
    console.error("notify failed", err);
  }
}
