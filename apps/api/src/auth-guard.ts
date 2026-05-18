import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { ApiError } from "./lib/errors.js";
import type { AuthUser, Role } from "./lib/auth.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: Role; name: string };
    user: { sub: string; email: string; role: Role; name: string };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

/** Paths under /api that do NOT require authentication. */
const PUBLIC_PATHS = new Set(["/api/auth/login"]);

/**
 * onRequest hook: verify the JWT and attach the live user. Public auth
 * endpoints are exempt. Rejects inactive/deleted users even with a valid token.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const routePath = (req as { routerPath?: string }).routerPath ?? req.url.split("?")[0];
  if (PUBLIC_PATHS.has(routePath)) return;

  try {
    await req.jwtVerify();
  } catch {
    throw new ApiError(401, "Authentication required");
  }
  const payload = req.user;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) {
    throw new ApiError(401, "Account is inactive or no longer exists");
  }
  req.authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  };
}

/** preHandler factory: require the caller to hold one of the given roles. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      throw new ApiError(403, "You do not have permission to do this");
    }
  };
}
