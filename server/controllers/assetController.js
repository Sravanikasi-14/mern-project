import {
  ASSET_STATUSES,
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ACKNOWLEDGEMENT_STATUSES,
} from "../models/CompanyAsset.js";
import { HttpError } from "../utils/httpError.js";

/**
 * GET /api/assets
 * Lists company asset inventory with filtering, search, pagination, and inventory summary metrics.
 * Restricted to HR_ADMIN.
 */
export async function listAssets(req, res, next) {
  try {
    const { CompanyAsset, Employee } = req.auth.models;
    const {
      search = "",
      category = "",
      status = "",
      condition = "",
      department = "",
      page = 1,
      limit = 25,
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (parsedPage - 1) * parsedLimit;

    // Filter Query
    const query = {};

    if (category && category !== "ALL") {
      query.category = category;
    }

    if (status && status !== "ALL") {
      query.status = status;
    }

    if (condition && condition !== "ALL") {
      query.condition = condition;
    }

    if (department && department !== "ALL") {
      query.department = department;
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term, "i");
      query.$or = [
        { name: regex },
        { assetTag: regex },
        { serialNumber: regex },
        { manufacturer: regex },
        { modelNumber: regex },
        { "currentAssignment.employeeName": regex },
        { "currentAssignment.employeeCode": regex },
      ];
    }

    const [assets, totalMatched, allAssetsCount] = await Promise.all([
      CompanyAsset.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      CompanyAsset.countDocuments(query),
      CompanyAsset.find({}, "status condition").lean(),
    ]);

    // Compute live inventory summary counts across all tenant assets
    const summary = {
      total: allAssetsCount.length,
      available: 0,
      assigned: 0,
      underMaintenance: 0,
      retired: 0,
      lost: 0,
      requiringAttention: 0,
    };

    for (const a of allAssetsCount) {
      if (a.status === ASSET_STATUSES.AVAILABLE) summary.available++;
      else if (a.status === ASSET_STATUSES.ASSIGNED) summary.assigned++;
      else if (a.status === ASSET_STATUSES.UNDER_MAINTENANCE) summary.underMaintenance++;
      else if (a.status === ASSET_STATUSES.RETIRED) summary.retired++;
      else if (a.status === ASSET_STATUSES.LOST) summary.lost++;

      if (
        a.status === ASSET_STATUSES.UNDER_MAINTENANCE ||
        a.status === ASSET_STATUSES.LOST ||
        a.condition === ASSET_CONDITIONS.DAMAGED ||
        a.condition === ASSET_CONDITIONS.POOR
      ) {
        summary.requiringAttention++;
      }
    }

    res.status(200).json({
      success: true,
      assets,
      data: assets,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: totalMatched,
        totalPages: Math.ceil(totalMatched / parsedLimit) || 1,
      },
      summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/assets
 * Creates a new company asset.
 * Restricted to HR_ADMIN.
 */
export async function createAsset(req, res, next) {
  try {
    const { CompanyAsset, AuditLog } = req.auth.models;
    const {
      assetTag,
      name,
      category = ASSET_CATEGORIES.LAPTOP,
      manufacturer = "",
      modelNumber = "",
      serialNumber = "",
      purchaseDate = null,
      purchaseCost = null,
      warrantyExpiry = null,
      condition = ASSET_CONDITIONS.GOOD,
      status = ASSET_STATUSES.AVAILABLE,
      location = "",
      department = "",
      notes = "",
    } = req.body;

    if (!assetTag || !assetTag.trim()) {
      throw new HttpError(400, "Asset ID / Tag is required.");
    }

    if (!name || !name.trim()) {
      throw new HttpError(400, "Asset name is required.");
    }

    const normalizedTag = assetTag.trim().toUpperCase();

    // Enforce uniqueness within company database
    const existing = await CompanyAsset.findOne({ assetTag: normalizedTag });
    if (existing) {
      throw new HttpError(409, `An asset with tag '${normalizedTag}' already exists in this company.`);
    }

    if (category && !Object.values(ASSET_CATEGORIES).includes(category)) {
      throw new HttpError(400, `Invalid asset category: ${category}`);
    }

    if (condition && !Object.values(ASSET_CONDITIONS).includes(condition)) {
      throw new HttpError(400, `Invalid asset condition: ${condition}`);
    }

    if (status && !Object.values(ASSET_STATUSES).includes(status)) {
      throw new HttpError(400, `Invalid asset status: ${status}`);
    }

    // New assets cannot be created directly as ASSIGNED without an employee assignment workflow
    const initialStatus = status === ASSET_STATUSES.ASSIGNED ? ASSET_STATUSES.AVAILABLE : status;

    const newAsset = await CompanyAsset.create({
      assetTag: normalizedTag,
      name: name.trim(),
      category,
      manufacturer: manufacturer?.trim() || "",
      modelNumber: modelNumber?.trim() || "",
      serialNumber: serialNumber?.trim() || "",
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: purchaseCost !== null && purchaseCost !== "" && !isNaN(purchaseCost) ? Number(purchaseCost) : null,
      warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
      condition,
      status: initialStatus,
      location: location?.trim() || "",
      department: department?.trim() || "",
      notes: notes?.trim() || "",
      createdBy: req.auth.user._id,
      updatedBy: req.auth.user._id,
    });

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_CREATED",
        targetType: "CompanyAsset",
        targetId: newAsset._id,
        changes: {
          assetTag: newAsset.assetTag,
          name: newAsset.name,
          category: newAsset.category,
        },
      });
    }

    res.status(201).json({
      success: true,
      asset: newAsset,
      data: newAsset,
      message: `Asset ${newAsset.assetTag} created successfully.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/assets/:id
 * Fetches asset details with assignment history.
 */
export async function getAssetDetails(req, res, next) {
  try {
    const { CompanyAsset } = req.auth.models;
    const { id } = req.params;

    let asset = null;
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      asset = await CompanyAsset.findById(id).lean();
    }
    if (!asset) {
      asset = await CompanyAsset.findOne({ assetTag: id.toUpperCase() }).lean();
    }

    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    res.status(200).json({
      success: true,
      asset,
      data: asset,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/assets/:id
 * Updates asset metadata, condition, or status.
 * Restricted to HR_ADMIN.
 */
export async function updateAsset(req, res, next) {
  try {
    const { CompanyAsset, AuditLog } = req.auth.models;
    const { id } = req.params;

    const asset = await CompanyAsset.findById(id);
    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    const {
      name,
      assetTag,
      category,
      manufacturer,
      modelNumber,
      serialNumber,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      condition,
      status,
      location,
      department,
      notes,
    } = req.body;

    if (name !== undefined) {
      if (!name.trim()) throw new HttpError(400, "Asset name cannot be empty.");
      asset.name = name.trim();
    }

    if (assetTag !== undefined && assetTag.trim()) {
      const normalizedTag = assetTag.trim().toUpperCase();
      if (normalizedTag !== asset.assetTag) {
        const existing = await CompanyAsset.findOne({ assetTag: normalizedTag, _id: { $ne: asset._id } });
        if (existing) {
          throw new HttpError(409, `An asset with tag '${normalizedTag}' already exists.`);
        }
        asset.assetTag = normalizedTag;
      }
    }

    if (category !== undefined) {
      if (!Object.values(ASSET_CATEGORIES).includes(category)) {
        throw new HttpError(400, `Invalid category: ${category}`);
      }
      asset.category = category;
    }

    if (manufacturer !== undefined) asset.manufacturer = manufacturer.trim();
    if (modelNumber !== undefined) asset.modelNumber = modelNumber.trim();
    if (serialNumber !== undefined) asset.serialNumber = serialNumber.trim();

    if (purchaseDate !== undefined) {
      asset.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    }

    if (purchaseCost !== undefined) {
      asset.purchaseCost = purchaseCost !== null && purchaseCost !== "" && !isNaN(purchaseCost) ? Number(purchaseCost) : null;
    }

    if (warrantyExpiry !== undefined) {
      asset.warrantyExpiry = warrantyExpiry ? new Date(warrantyExpiry) : null;
    }

    if (condition !== undefined) {
      if (!Object.values(ASSET_CONDITIONS).includes(condition)) {
        throw new HttpError(400, `Invalid condition: ${condition}`);
      }
      asset.condition = condition;
    }

    // Status transition validation
    if (status !== undefined && status !== asset.status) {
      if (!Object.values(ASSET_STATUSES).includes(status)) {
        throw new HttpError(400, `Invalid status: ${status}`);
      }

      // Cannot manually transition to ASSIGNED via generic update (must use /assign)
      if (status === ASSET_STATUSES.ASSIGNED && !asset.currentAssignment?.employeeId) {
        throw new HttpError(400, "Cannot change status to ASSIGNED directly. Use the Assign Asset action.");
      }

      // If currently ASSIGNED, cannot mark AVAILABLE, RETIRED, or UNDER_MAINTENANCE without returning first
      if (asset.status === ASSET_STATUSES.ASSIGNED && status !== ASSET_STATUSES.ASSIGNED) {
        throw new HttpError(400, "Asset is currently assigned. Please record an asset return before changing status.");
      }

      asset.status = status;
    }

    if (location !== undefined) asset.location = location.trim();
    if (department !== undefined) asset.department = department.trim();
    if (notes !== undefined) asset.notes = notes.trim();

    asset.updatedBy = req.auth.user._id;
    await asset.save();

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_UPDATED",
        targetType: "CompanyAsset",
        targetId: asset._id,
        changes: { name: asset.name, status: asset.status, condition: asset.condition },
      });
    }

    res.status(200).json({
      success: true,
      asset,
      data: asset,
      message: "Asset updated successfully.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/assets/:id/assign
 * Assigns an available asset to an active employee.
 * Restricted to HR_ADMIN.
 */
export async function assignAsset(req, res, next) {
  try {
    const { CompanyAsset, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;
    const {
      employeeId,
      assignedDate = new Date(),
      conditionAtAssignment,
      notes = "",
    } = req.body;

    if (!employeeId) {
      throw new HttpError(400, "Employee ID is required for asset assignment.");
    }

    const asset = await CompanyAsset.findById(id);
    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    // Lifecycle rule: Only AVAILABLE assets can be assigned
    if (asset.status === ASSET_STATUSES.ASSIGNED && asset.currentAssignment?.employeeId) {
      throw new HttpError(400, `Asset is already assigned to ${asset.currentAssignment.employeeName} (${asset.currentAssignment.employeeCode}). Record a return before reassigning.`);
    }

    if (asset.status === ASSET_STATUSES.UNDER_MAINTENANCE) {
      throw new HttpError(400, "Asset is currently under maintenance and cannot be assigned.");
    }

    if (asset.status === ASSET_STATUSES.RETIRED || asset.status === ASSET_STATUSES.LOST) {
      throw new HttpError(400, `Asset cannot be assigned because its status is ${asset.status}.`);
    }

    // Validate employee exists within authenticated tenant and is active
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      throw new HttpError(404, "Selected employee was not found in this company.");
    }

    if (employee.status !== "ACTIVE") {
      throw new HttpError(400, `Cannot assign assets to inactive employee (Status: ${employee.status}).`);
    }

    const validatedCondition = conditionAtAssignment && Object.values(ASSET_CONDITIONS).includes(conditionAtAssignment)
      ? conditionAtAssignment
      : asset.condition;

    // Apply assignment
    asset.status = ASSET_STATUSES.ASSIGNED;
    asset.condition = validatedCondition;
    asset.currentAssignment = {
      employeeId: employee._id,
      employeeCode: employee.employeeCode || "",
      employeeName: employee.fullName || `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
      assignedDate: new Date(assignedDate),
      conditionAtAssignment: validatedCondition,
      acknowledgementStatus: ACKNOWLEDGEMENT_STATUSES.PENDING,
      acknowledgedAt: null,
      assignedBy: req.auth.user._id,
      notes: notes?.trim() || "",
    };
    asset.updatedBy = req.auth.user._id;

    await asset.save();

    // Safe legacy synchronization with employee.customFields.assignedAssets
    try {
      const existingLegacyAssets = Array.isArray(employee.customFields?.assignedAssets)
        ? [...employee.customFields.assignedAssets]
        : [];

      // Check if item with this serial or asset tag already exists in customFields
      const alreadyPresent = existingLegacyAssets.some(
        (a) =>
          (typeof a === "object" && a.serial === (asset.serialNumber || asset.assetTag)) ||
          (typeof a === "string" && a === asset.name)
      );

      if (!alreadyPresent) {
        existingLegacyAssets.push({
          name: asset.name,
          serial: asset.serialNumber || asset.assetTag,
          assetTag: asset.assetTag,
          category: asset.category,
          assignedDate: new Date(assignedDate).toISOString().split("T")[0],
          condition: validatedCondition,
        });

        employee.customFields = {
          ...(employee.customFields || {}),
          assignedAssets: existingLegacyAssets,
        };
        employee.markModified("customFields");
        await employee.save();
      }
    } catch (syncErr) {
      console.warn("[CompanyAsset] Legacy sync warning:", syncErr.message);
    }

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_ASSIGNED",
        targetType: "CompanyAsset",
        targetId: asset._id,
        changes: {
          assetTag: asset.assetTag,
          assignedTo: employee.fullName,
          employeeCode: employee.employeeCode,
          assignedDate,
        },
      });
    }

    res.status(200).json({
      success: true,
      asset,
      data: asset,
      message: `Asset ${asset.assetTag} successfully assigned to ${employee.fullName}.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/assets/:id/return
 * Closes active assignment, records return condition and history, and updates asset availability.
 * Restricted to HR_ADMIN.
 */
export async function returnAsset(req, res, next) {
  try {
    const { CompanyAsset, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;
    const {
      returnDate = new Date(),
      conditionAtReturn,
      returnNotes = "",
      nextStatus = ASSET_STATUSES.AVAILABLE,
    } = req.body;

    const asset = await CompanyAsset.findById(id);
    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    if (!asset.currentAssignment || !asset.currentAssignment.employeeId) {
      throw new HttpError(400, "Asset is not currently assigned to any employee.");
    }

    const previousAssignment = asset.currentAssignment;
    const returnedCondition = conditionAtReturn && Object.values(ASSET_CONDITIONS).includes(conditionAtReturn)
      ? conditionAtReturn
      : asset.condition;

    // Determine post-return status based on condition or explicit selection
    let determinedNextStatus = nextStatus;
    if (!determinedNextStatus || determinedNextStatus === ASSET_STATUSES.ASSIGNED) {
      if (returnedCondition === ASSET_CONDITIONS.DAMAGED || returnedCondition === ASSET_CONDITIONS.POOR) {
        determinedNextStatus = ASSET_STATUSES.UNDER_MAINTENANCE;
      } else {
        determinedNextStatus = ASSET_STATUSES.AVAILABLE;
      }
    }

    // Archive into assignment history
    asset.assignmentHistory.push({
      employeeId: previousAssignment.employeeId,
      employeeCode: previousAssignment.employeeCode,
      employeeName: previousAssignment.employeeName,
      assignedDate: previousAssignment.assignedDate,
      conditionAtAssignment: previousAssignment.conditionAtAssignment,
      returnDate: new Date(returnDate),
      conditionAtReturn: returnedCondition,
      returnNotes: returnNotes?.trim() || "",
      acknowledgementStatus: previousAssignment.acknowledgementStatus,
      acknowledgedAt: previousAssignment.acknowledgedAt,
      assignedBy: previousAssignment.assignedBy,
      returnedBy: req.auth.user._id,
      notes: previousAssignment.notes,
    });

    // Clear current assignment
    asset.currentAssignment = null;
    asset.status = determinedNextStatus;
    asset.condition = returnedCondition;
    asset.updatedBy = req.auth.user._id;

    await asset.save();

    // Remove or update from legacy employee.customFields.assignedAssets
    try {
      const employee = await Employee.findById(previousAssignment.employeeId);
      if (employee && Array.isArray(employee.customFields?.assignedAssets)) {
        const remaining = employee.customFields.assignedAssets.filter(
          (a) =>
            (typeof a === "object" && a.serial !== (asset.serialNumber || asset.assetTag) && a.assetTag !== asset.assetTag) ||
            (typeof a === "string" && a !== asset.name)
        );
        employee.customFields = {
          ...(employee.customFields || {}),
          assignedAssets: remaining,
        };
        employee.markModified("customFields");
        await employee.save();
      }
    } catch (syncErr) {
      console.warn("[CompanyAsset] Legacy sync return warning:", syncErr.message);
    }

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_RETURNED",
        targetType: "CompanyAsset",
        targetId: asset._id,
        changes: {
          assetTag: asset.assetTag,
          returnedFrom: previousAssignment.employeeName,
          conditionAtReturn: returnedCondition,
          nextStatus: determinedNextStatus,
        },
      });
    }

    res.status(200).json({
      success: true,
      asset,
      data: asset,
      message: `Asset ${asset.assetTag} return recorded successfully. Asset is now ${determinedNextStatus}.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/assets/:id
 * Deletes an unassigned asset.
 * Restricted to HR_ADMIN.
 */
export async function deleteAsset(req, res, next) {
  try {
    const { CompanyAsset, AuditLog } = req.auth.models;
    const { id } = req.params;

    const asset = await CompanyAsset.findById(id);
    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    if (asset.status === ASSET_STATUSES.ASSIGNED || asset.currentAssignment?.employeeId) {
      throw new HttpError(400, "Cannot delete an asset with an active assignment. Please record its return first.");
    }

    await CompanyAsset.findByIdAndDelete(id);

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_DELETED",
        targetType: "CompanyAsset",
        targetId: id,
        changes: { assetTag: asset.assetTag, name: asset.name },
      });
    }

    res.status(200).json({
      success: true,
      message: `Asset ${asset.assetTag} removed from inventory.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/assets/my-assets
 * Authenticated employee accesses only assets assigned to them.
 */
export async function getMyAssets(req, res, next) {
  try {
    const { CompanyAsset, Employee } = req.auth.models;

    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee profile not found.");
    }

    // Authoritative query: Assigned assets belonging to this employee
    const assignedAssets = await CompanyAsset.find({
      "currentAssignment.employeeId": employee._id,
      status: ASSET_STATUSES.ASSIGNED,
    })
      .sort({ "currentAssignment.assignedDate": -1 })
      .lean();

    // Also fetch permitted historical assignments for this employee
    const historicalAssets = await CompanyAsset.find({
      "assignmentHistory.employeeId": employee._id,
      "currentAssignment.employeeId": { $ne: employee._id },
    })
      .sort({ updatedAt: -1 })
      .lean();

    const formattedHistory = [];
    for (const ha of historicalAssets) {
      const records = (ha.assignmentHistory || []).filter(
        (h) => String(h.employeeId) === String(employee._id)
      );
      for (const rec of records) {
        formattedHistory.push({
          assetId: ha._id,
          assetTag: ha.assetTag,
          name: ha.name,
          category: ha.category,
          manufacturer: ha.manufacturer,
          modelNumber: ha.modelNumber,
          serialNumber: ha.serialNumber,
          assignedDate: rec.assignedDate,
          returnDate: rec.returnDate,
          conditionAtAssignment: rec.conditionAtAssignment,
          conditionAtReturn: rec.conditionAtReturn,
          acknowledgementStatus: rec.acknowledgementStatus,
        });
      }
    }

    // Merge any legacy customFields items that haven't been linked to CompanyAsset
    const legacyAssets = Array.isArray(employee.customFields?.assignedAssets)
      ? employee.customFields.assignedAssets
      : [];

    const existingTagsOrSerials = new Set(
      assignedAssets.map((a) => (a.serialNumber || a.assetTag).toLowerCase())
    );

    const unmigratedLegacy = [];
    for (const leg of legacyAssets) {
      const key = typeof leg === "object" ? (leg.serial || leg.name || "").toLowerCase() : String(leg).toLowerCase();
      if (!existingTagsOrSerials.has(key)) {
        unmigratedLegacy.push({
          id: `LEGACY-${Math.random().toString(36).substring(2, 9)}`,
          name: typeof leg === "object" ? leg.name : leg,
          serialNumber: typeof leg === "object" ? leg.serial || "N/A" : "N/A",
          assetTag: typeof leg === "object" ? leg.assetTag || "LEGACY" : "LEGACY",
          category: typeof leg === "object" ? leg.category || "OTHER" : "OTHER",
          assignedDate: typeof leg === "object" ? leg.assignedDate : null,
          condition: "GOOD",
          status: "ASSIGNED",
          isLegacy: true,
          acknowledgementStatus: "ACKNOWLEDGED",
        });
      }
    }

    res.status(200).json({
      success: true,
      assets: [...assignedAssets, ...unmigratedLegacy],
      data: [...assignedAssets, ...unmigratedLegacy],
      history: formattedHistory,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/assets/my-assets/:id/acknowledge
 * Allows authenticated employee to acknowledge receipt of an assigned asset.
 */
export async function acknowledgeAssetReceipt(req, res, next) {
  try {
    const { CompanyAsset, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;

    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee profile not found.");
    }

    const asset = await CompanyAsset.findById(id);
    if (!asset) {
      throw new HttpError(404, "Asset not found.");
    }

    // Server-side ownership authorization: employee can ONLY acknowledge their own assigned asset
    if (!asset.currentAssignment || String(asset.currentAssignment.employeeId) !== String(employee._id)) {
      throw new HttpError(403, "Access denied: You are not authorized to acknowledge this asset.");
    }

    if (asset.currentAssignment.acknowledgementStatus === ACKNOWLEDGEMENT_STATUSES.ACKNOWLEDGED) {
      return res.status(200).json({
        success: true,
        asset,
        data: asset,
        message: "Asset receipt has already been acknowledged.",
      });
    }

    asset.currentAssignment.acknowledgementStatus = ACKNOWLEDGEMENT_STATUSES.ACKNOWLEDGED;
    asset.currentAssignment.acknowledgedAt = new Date();
    await asset.save();

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "COMPANY_ASSET_ACKNOWLEDGED",
        targetType: "CompanyAsset",
        targetId: asset._id,
        changes: {
          assetTag: asset.assetTag,
          acknowledgedBy: employee.fullName,
          acknowledgedAt: asset.currentAssignment.acknowledgedAt,
        },
      });
    }

    res.status(200).json({
      success: true,
      asset,
      data: asset,
      message: `Receipt of asset ${asset.assetTag} (${asset.name}) successfully acknowledged.`,
    });
  } catch (error) {
    next(error);
  }
}
