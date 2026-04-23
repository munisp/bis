/** BIS SDK Error Classes */

export class BISError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 0,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'BISError';
  }
}

export class BISAuthError extends BISError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'BISAuthError';
  }
}

export class BISRateLimitError extends BISError {
  constructor(
    message = 'Rate limit exceeded',
    public readonly retryAfter: number = 60,
  ) {
    super(message, 429, 'RATE_LIMITED');
    this.name = 'BISRateLimitError';
  }
}

export class BISNotFoundError extends BISError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'BISNotFoundError';
  }
}

export class BISValidationError extends BISError {
  constructor(
    message: string,
    public readonly errors: Record<string, string[]> = {},
  ) {
    super(message, 422, 'VALIDATION_ERROR');
    this.name = 'BISValidationError';
  }
}
