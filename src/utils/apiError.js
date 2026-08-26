'use strict';

/**
 * Consistent API error type.
 * Serialized as:
 * { success:false, error:{ code, message, details } }
 */
class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const ApiErrors = {
  badRequest: (msg = 'Bad request', code = 'BAD_REQUEST', details = null) => new ApiError(400, code, msg, details),
  validation: (details) => new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', details),
  unauthorized: (msg = 'Authentication required', code = 'UNAUTHORIZED') => new ApiError(401, code, msg),
  invalidCredentials: (msg = 'Invalid email or password') => new ApiError(401, 'INVALID_CREDENTIALS', msg),
  forbidden: (msg = 'Permission denied') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Resource not found', code = 'NOT_FOUND') => new ApiError(404, code, msg),
  conflict: (msg = 'Conflict', code = 'CONFLICT') => new ApiError(409, code, msg),
  invalidTransition: (msg) => new ApiError(409, 'INVALID_STATUS_TRANSITION', msg),
  tooMany: (msg = 'Too many requests', code = 'RATE_LIMITED') => new ApiError(429, code, msg),
  internal: () => new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'),
  providerUnavailable: (name) =>
    new ApiError(503, 'PROVIDER_UNAVAILABLE', `${name} provider is not configured`),
};

/** Wrap async route handlers so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, ApiErrors, asyncHandler };
