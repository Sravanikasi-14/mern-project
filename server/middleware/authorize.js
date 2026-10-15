import { HttpError } from "../utils/httpError.js";

export function requireRole(...roles) {
  return (req, _res, next) => {
    const role = req.auth?.user?.role;

    if (!role) {
      return next(new HttpError(401, "Authentication required"));
    }

    if (!roles.includes(role)) {
      return next(new HttpError(403, "You do not have access to this resource"));
    }

    next();
  };
}
