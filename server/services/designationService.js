import mongoose from "mongoose";
import { serializeDesignation } from "../models/Designation.js";
import { isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

const indexedDatabases = new Set();

async function ensureDesignationIndexes(Designation) {
  const databaseName = Designation?.db?.name || Designation?.collection?.conn?.name;
  if (!databaseName || indexedDatabases.has(databaseName)) return;
  await Designation.createIndexes();
  indexedDatabases.add(databaseName);
}

function requireHrPortalOperator(actorUser) {
  if (!isHrPortalOperator(actorUser?.role)) {
    throw new HttpError(403, "You do not have access to this resource");
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanText(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, max);
}

async function titleUsageCounts(Employee) {
  if (!Employee) return new Map();
  const rows = await Employee.aggregate([
    {
      $project: {
        title: {
          $toLower: {
            $trim: { input: { $ifNull: ["$job.jobTitle", ""] } },
          },
        },
      },
    },
    { $match: { title: { $ne: "" } } },
    { $group: { _id: "$title", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

function statusFilter(options = {}) {
  const status = typeof options.status === "string" ? options.status.trim().toLowerCase() : "";
  if (status === "all" || options.includeInactive === true) return {};
  if (status === "inactive") return { isActive: false };
  return { isActive: true };
}

export async function listDesignations(models, options = {}) {
  await ensureDesignationIndexes(models.Designation);
  const filter = statusFilter(options);
  const search = typeof options.search === "string" ? options.search.trim() : "";
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: pattern }, { grade: pattern }, { description: pattern }];
  }
  const rows = await models.Designation.find(filter).sort({ title: 1 }).lean();
  const usage = await titleUsageCounts(models.Employee);
  return rows.map((row) =>
    serializeDesignation(row, usage.get(String(row.normalizedTitle || "").toLowerCase()) || 0)
  );
}

async function assertUniqueTitle(Designation, normalizedTitle, excludeId = null) {
  const query = { normalizedTitle };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Designation.findOne(query).select("_id isActive").lean();
  if (existing) {
    throw new HttpError(409, "A designation with this title already exists.", {
      field: "title",
      code: "DUPLICATE_DESIGNATION",
    });
  }
}

export async function createDesignation(models, actorUser, payload = {}) {
  requireHrPortalOperator(actorUser);
  await ensureDesignationIndexes(models.Designation);
  const title = cleanText(payload.title, 200);
  if (!title) {
    throw new HttpError(400, "Designation title is required.", { field: "title" });
  }
  const normalizedTitle = title.toLowerCase();
  await assertUniqueTitle(models.Designation, normalizedTitle);

  let created;
  try {
    created = await models.Designation.create({
      title,
      normalizedTitle,
      grade: cleanText(payload.grade, 80),
      description: cleanText(payload.description, 1000),
      isActive: payload.isActive === false ? false : true,
      createdBy: actorUser._id,
      updatedBy: actorUser._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "A designation with this title already exists.", {
        field: "title",
        code: "DUPLICATE_DESIGNATION",
      });
    }
    throw err;
  }
  return serializeDesignation(created);
}

export async function updateDesignation(models, actorUser, designationId, payload = {}) {
  requireHrPortalOperator(actorUser);
  if (!mongoose.Types.ObjectId.isValid(designationId)) {
    throw new HttpError(404, "Designation not found.");
  }
  const designation = await models.Designation.findById(designationId);
  if (!designation) {
    throw new HttpError(404, "Designation not found.");
  }

  if (payload.title !== undefined) {
    const title = cleanText(payload.title, 200);
    if (!title) {
      throw new HttpError(400, "Designation title is required.", { field: "title" });
    }
    const normalizedTitle = title.toLowerCase();
    await assertUniqueTitle(models.Designation, normalizedTitle, designation._id);
    designation.title = title;
    designation.normalizedTitle = normalizedTitle;
  }
  if (payload.grade !== undefined) {
    designation.grade = cleanText(payload.grade, 80);
  }
  if (payload.description !== undefined) {
    designation.description = cleanText(payload.description, 1000);
  }
  if (payload.isActive !== undefined) {
    designation.isActive = Boolean(payload.isActive);
  }

  designation.updatedBy = actorUser._id;
  try {
    await designation.save();
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "A designation with this title already exists.", {
        field: "title",
        code: "DUPLICATE_DESIGNATION",
      });
    }
    throw err;
  }
  const usage = await titleUsageCounts(models.Employee);
  return serializeDesignation(
    designation,
    usage.get(String(designation.normalizedTitle || "").toLowerCase()) || 0
  );
}

export async function deactivateDesignation(models, actorUser, designationId) {
  requireHrPortalOperator(actorUser);
  if (!mongoose.Types.ObjectId.isValid(designationId)) {
    throw new HttpError(404, "Designation not found.");
  }
  const designation = await models.Designation.findById(designationId);
  if (!designation) {
    throw new HttpError(404, "Designation not found.");
  }
  designation.isActive = false;
  designation.updatedBy = actorUser._id;
  await designation.save();
  const usage = await titleUsageCounts(models.Employee);
  return serializeDesignation(
    designation,
    usage.get(String(designation.normalizedTitle || "").toLowerCase()) || 0
  );
}
