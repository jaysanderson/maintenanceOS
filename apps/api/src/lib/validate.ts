import { z, type ZodTypeAny } from "zod";
import { badRequest } from "./errors.js";

export function parse<S extends ZodTypeAny>(
  schema: S,
  data: unknown
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest("Validation failed", result.error.flatten());
  }
  return result.data;
}
