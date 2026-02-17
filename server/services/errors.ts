export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;
  retryAfterSec?: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryAfterSec?: number
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSec = retryAfterSec;
  }
}

export function badRequest(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return new ApiError(400, code, message, details);
}

export function unauthorised(code: string, message: string): ApiError {
  return new ApiError(401, code, message);
}

export function forbidden(code: string, message: string): ApiError {
  return new ApiError(403, code, message);
}

export function notFound(code: string, message: string): ApiError {
  return new ApiError(404, code, message);
}

export function conflict(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return new ApiError(409, code, message, details);
}

export function rateLimited(message: string, retryAfterSec?: number): ApiError {
  return new ApiError(429, "RATE_LIMITED", message, undefined, retryAfterSec);
}
