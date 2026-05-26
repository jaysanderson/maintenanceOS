/**
 * Personal Access Tokens — create, list, revoke. Used to authenticate
 * long-lived integrations (Claude Desktop's MCP connector, n8n, internal
 * scripts) without handing them a 12-hour session JWT.
 *
 * Routes are mounted under /api/access-tokens and inherit the standard
 * `requireAuth` hook, so only the logged-in user can manage their own
 * tokens. Tokens are scoped to the calling user.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import {
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
} from "../lib/access-tokens.js";

const createBody = z.object({
  name: z.string().min(1).max(80),
  /** Optional expiry. Default null = never expires. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export async function accessTokenRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        tags: ["AccessTokens"],
        summary: "List your personal access tokens (raw values are never returned)",
      },
    },
    async (req) => {
      const tokens = await listAccessTokens(req.authUser.id);
      return { tokens };
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["AccessTokens"],
        summary: "Create a personal access token. The raw value is shown ONCE.",
        body: createBody,
      },
    },
    async (req) => {
      const { name, expiresInDays } = req.body as z.infer<typeof createBody>;
      const minted = await createAccessToken({
        userId: req.authUser.id,
        name,
        expiresInDays: expiresInDays ?? null,
      });
      await audit(req.authUser, {
        action: "ACCESS_TOKEN_CREATED",
        entity: "AccessToken",
        entityId: minted.id,
        summary: `Created access token "${minted.name}" (${minted.prefix})`,
      });
      // The raw `token` is the only place a client will ever see this
      // value — every list response after this only carries the prefix.
      return {
        id: minted.id,
        name: minted.name,
        prefix: minted.prefix,
        token: minted.token,
        expiresAt: minted.expiresAt,
        createdAt: minted.createdAt,
      };
    }
  );

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["AccessTokens"],
        summary: "Revoke a personal access token",
        params: z.object({ id: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await revokeAccessToken({
        userId: req.authUser.id,
        tokenId: id,
      });
      if (!ok) {
        reply.code(404);
        return { error: "Token not found or already revoked" };
      }
      await audit(req.authUser, {
        action: "ACCESS_TOKEN_REVOKED",
        entity: "AccessToken",
        entityId: id,
        summary: `Revoked access token ${id}`,
      });
      return { ok: true };
    }
  );
}
