export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let code = err.code;
  let message = err.message || "An unexpected error occurred. Please try again.";
  let errors = err.errors;

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    status = 409;
    code = "CONFLICT";
    const key = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (key === "employeeCode") {
      message = "An employee with this employee code already exists.";
      errors = { employeeCode: message };
    } else if (key === "email") {
      message = "An account with this email address already exists.";
      errors = { email: message };
    } else if (key === "slug") {
      message = "A company with this company code already exists.";
      errors = { companyCode: message };
    } else {
      message = "A record with these details already exists.";
    }
  }

  // Handle Mongoose ValidationError
  if (err.name === "ValidationError") {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Please correct the highlighted errors.";
    errors = {};
    for (const [key, val] of Object.entries(err.errors || {})) {
      errors[key] = val.message;
    }
  }

  // Distinguish service unavailable (503) from unexpected server errors (500)
  if (status >= 500) {
    if (process.env.NODE_ENV !== "test") {
      console.error(err.name || "ServerError", err.message);
    }
    if (status === 503 || code === "SERVICE_UNAVAILABLE") {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message = "We're unable to connect right now. Please try again in a moment.";
    } else {
      status = 500;
      code = "SERVER_ERROR";
      message = "Something went wrong on our side. Please try again later.";
    }
  }

  if (!code) {
    code = status >= 500 ? "SERVER_ERROR" : "ERROR";
  }

  res.status(status).json({
    code,
    message,
    ...(errors ? { errors } : {}),
  });
}
