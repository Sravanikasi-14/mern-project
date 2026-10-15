function defaultCodeForStatus(status) {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "SERVER_ERROR" : "ERROR";
  }
}

export class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.name = "HttpError";
    this.code = details.code || defaultCodeForStatus(status);
    if (details.errors) {
      this.errors = details.errors;
    }
    if (details.field) {
      this.field = details.field;
    }
  }
}

