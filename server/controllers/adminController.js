import { USER_ROLES } from "../models/User.js";

export async function getAdminOverview(req, res, next) {
  try {
    const { User } = req.auth.models;
    const [hrAdminCount, employeeCount] = await Promise.all([
      User.countDocuments({ role: USER_ROLES.HR_ADMIN }),
      User.countDocuments({ role: USER_ROLES.EMPLOYEE }),
    ]);

    res.json({
      companyName: req.auth.company.companyName,
      slug: req.auth.company.slug,
      hrAdminCount,
      employeeCount,
    });
  } catch (error) {
    next(error);
  }
}
