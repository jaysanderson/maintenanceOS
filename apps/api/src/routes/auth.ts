import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { ApiError } from "../lib/errors.js";
import { verifyPassword, type Role } from "../lib/auth.js";
import { audit } from "../lib/audit.js";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/login",
    { schema: { tags: ["Auth"], summary: "Log in, returns a JWT" } },
    async (req) => {
      const { email, password } = parse(
        z.object({ email: z.string().email(), password: z.string().min(1) }),
        req.body
      );
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
        throw new ApiError(401, "Invalid email or password");
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      const role = user.role as Role;
      const token = app.jwt.sign(
        { sub: user.id, email: user.email, role, name: user.name },
        { expiresIn: "12h" }
      );
      await audit(
        { id: user.id, email: user.email, name: user.name, role },
        { action: "LOGIN", summary: `${user.email} logged in` }
      );
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    }
  );

  app.get(
    "/me",
    { schema: { tags: ["Auth"], summary: "Current user" } },
    async (req) => {
      return req.authUser;
    }
  );

  app.post(
    "/logout",
    { schema: { tags: ["Auth"], summary: "Log out (client discards token)" } },
    async () => ({ ok: true })
  );
}
