"""BIS SDK Exceptions"""


class BISError(Exception):
    """Base exception for all BIS SDK errors."""

    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BISAuthError(BISError):
    """Raised when authentication fails (401)."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, status_code=401)


class BISRateLimitError(BISError):
    """Raised when rate limit is exceeded (429)."""

    def __init__(self, message: str = "Rate limit exceeded", retry_after: int = 60):
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


class BISNotFoundError(BISError):
    """Raised when a resource is not found (404)."""

    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, status_code=404)


class BISValidationError(BISError):
    """Raised when request validation fails (422)."""

    def __init__(self, message: str, errors: dict = None):
        super().__init__(message, status_code=422)
        self.errors = errors or {}
