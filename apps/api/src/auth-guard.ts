import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { ApiError } from "./lib/errors.js";
import type { AuthUser, Role } from "./lib/auth.js";
import {
  looksLikeAccessToken,
  verifyAccessToken,
} from "./lib/access-tokens.js";

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

/** Pull a bearer token off the Authorization header, if present. */
function extractBearer(req: FastifyRequest): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return undefined;
  if (!auth.toLowerCase().startsWith("bearer ")) return undefined;
  return auth.slice(7).trim() || undefined;
}

/**
 * onRequest hook: verify the caller's bearer (either a session JWT or a
 * long-lived access token) and attach the live user. Public auth endpoints
 * are exempt. Rejects inactive/deleted users even with a valid token.
 *
 * We dispatch on the token shape: access tokens start with `mos_` and are
 * looked up by sha256 hash. Anything else falls through to JWT verify —
 * preserving the existing flow for browser sessions.
 */
export async function requireAuth(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const routePath = (req as { routerPath?: string }).routerPath ?? req.url.split("?")[0];
  if (PUBLIC_PATHS.has(routePath)) return;

  const bearer = extractBearer(req);
  let userId: string | null = null;

  if (bearer && looksLikeAccessToken(bearer)) {
    const verified = await verifyAccessToken(bearer);
    if (!verified) {
      throw new ApiError(401, "Access token is invalid, revoked, or expired");
    }
    userId = verified.userId;
  } else {
    try {
      await req.jwtVerify();
    } catch {
      throw new ApiError(401, "Authentication required");
    }
    userId = req.user.sub;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
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
