export class ApiError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const notFound = (entity: string) =>
  new ApiError(404, `${entity} not found`);

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details);

export const conflict = (message: string) => new ApiError(409, message);
