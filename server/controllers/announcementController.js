import { HttpError } from "../utils/httpError.js";
import {
  announcementReadStatus,
  createAnnouncement,
  cronAuthorized,
  getAnnouncement,
  listAnnouncements,
  markAnnouncementRead,
  publishAnnouncement,
  publishDueForAllCompanies,
  updateAnnouncement,
  withdrawAnnouncement,
} from "../services/announcementService.js";

export async function publishDueAnnouncementsNow(req, res, next) {
  try {
    const verdict = cronAuthorized(req);
    if (verdict === "unconfigured") {
      throw new HttpError(503, "Scheduled publication is not configured.");
    }
    if (verdict !== "ok") {
      throw new HttpError(401, "Unauthorized");
    }
    const result = await publishDueForAllCompanies();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncements(req, res, next) {
  try {
    const result = await listAnnouncements(req);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function postAnnouncement(req, res, next) {
  try {
    const announcement = await createAnnouncement(req);
    res.status(201).json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncementById(req, res, next) {
  try {
    const announcement = await getAnnouncement(req, req.params.id);
    res.json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
}

export async function patchAnnouncement(req, res, next) {
  try {
    const announcement = await updateAnnouncement(req, req.params.id);
    res.json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
}

export async function postPublishAnnouncement(req, res, next) {
  try {
    const announcement = await publishAnnouncement(req, req.params.id);
    res.json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
}

export async function postWithdrawAnnouncement(req, res, next) {
  try {
    const announcement = await withdrawAnnouncement(req, req.params.id);
    res.json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
}

export async function postAnnouncementRead(req, res, next) {
  try {
    const result = await markAnnouncementRead(req, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getAnnouncementReadStatus(req, res, next) {
  try {
    const result = await announcementReadStatus(req, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}
