import mongoose from "mongoose";
import { CONVERSATION_TYPES, directKeyFor } from "../models/Conversation.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { MESSAGE_BODY_MAX } from "../models/Message.js";
import { linkMessageAttachments, prepareMessageAttachments, publicAttachments, releaseMessageAttachments } from "./chatAttachmentService.js";
import { HttpError } from "../utils/httpError.js";
import { isStrictObjectId } from "./reportingManagerService.js";

const PORTAL_ROLES = Object.freeze([
  USER_ROLES.COMPANY_ADMIN,
  USER_ROLES.HR_ADMIN,
  USER_ROLES.EMPLOYEE,
]);

const PAGE_SIZE = 40;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_BATCH_SIZE = 40;
const SEARCH_MAX_BATCHES = 8;
const SEARCH_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const DIRECTORY_LIMIT = 40;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function displayName(user, employee) {
  const fromEmployee = employee?.fullName || employee?.preferredName;
  if (fromEmployee && String(fromEmployee).trim()) return String(fromEmployee).trim();
  if (user?.fullName && String(user.fullName).trim()) return String(user.fullName).trim();
  if (user?.email) return String(user.email);
  return "Colleague";
}

export function publicCard(user, employee) {
  return {
    userId: String(user._id),
    displayName: displayName(user, employee),
    role: user.role,
    employeeCode: employee?.employeeCode || "",
    jobTitle: employee?.job?.jobTitle || "",
    department: employee?.job?.department || "",
  };
}

export async function employeesByUser(Employee, users) {
  const ids = users.map((user) => user.employeeId).filter(Boolean);
  if (!Employee || ids.length === 0) return new Map();
  const rows = await Employee.find({ _id: { $in: ids } })
    .select("fullName preferredName employeeCode status job.jobTitle job.department userId")
    .lean();
  const byUser = new Map();
  for (const row of rows) {
    const owner = users.find((user) => user.employeeId && String(user.employeeId) === String(row._id));
    if (owner) byUser.set(String(owner._id), row);
  }
  return byUser;
}

export function assertObjectId(value, message) {
  if (!isStrictObjectId(value)) {
    throw new HttpError(400, message);
  }
  return new mongoose.Types.ObjectId(String(value));
}

export async function requireActiveMember(models, conversationId, userId) {
  const member = await models.ConversationMember.findOne({
    conversationId,
    userId,
    leftAt: null,
  }).lean();
  if (!member) {
    throw new HttpError(404, "Conversation not found");
  }
  return member;
}

export async function loadPortalUser(User, userId) {
  return User.findOne({
    _id: userId,
    isActive: true,
    role: { $in: PORTAL_ROLES },
  })
    .select("fullName email role employeeId isActive")
    .lean();
}

function messageDto(message, senderName = "", replyTo = null) {
  const removed = Boolean(message.deletedAt);
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    senderUserId: String(message.senderUserId),
    senderName,
    body: removed ? "" : message.body || "",
    deleted: removed,
    attachments: publicAttachments(message),
    editedAt: message.editedAt || null,
    createdAt: message.createdAt,
    replyTo,
  };
}

function previewText(message) {
  if (!message || message.deletedAt) return "This message was deleted";
  const body = String(message.body || "").trim();
  if (body) return body.length > 140 ? `${body.slice(0, 137)}...` : body;
  const files = message.attachments || [];
  if (files.length === 1) return files[0].fileName || "Attachment";
  if (files.length > 1) return `${files.length} attachments`;
  return "";
}

async function senderNameMap(models, messages) {
  const ids = [...new Set(messages.map((message) => String(message.senderUserId)))];
  if (ids.length === 0) return new Map();
  const users = await models.User.find({ _id: { $in: ids } })
    .select("fullName email role employeeId")
    .lean();
  const employeeMap = await employeesByUser(models.Employee, users);
  const names = new Map();
  for (const account of users) {
    names.set(String(account._id), displayName(account, employeeMap.get(String(account._id))));
  }
  return names;
}

function visibleSince(member) {
  return member?.joinedAt ? new Date(member.joinedAt) : new Date(0);
}

async function unreadCountForMember(Message, member, userId) {
  const filter = {
    conversationId: member.conversationId,
    senderUserId: { $ne: userId },
    deletedAt: null,
    createdAt: { $gte: visibleSince(member) },
  };
  if (member.lastReadMessageId) {
    filter._id = { $gt: member.lastReadMessageId };
  }
  return Message.countDocuments(filter);
}

async function notifyRecipient({ models, recipient, senderName, conversationId, preview }) {
  if (!models.Notification || !recipient || recipient.muted) return;
  const title = senderName || "New message";
  const message = preview || "You have a new message.";
  const link = recipient.role === USER_ROLES.EMPLOYEE
    ? `/app/messages?c=${conversationId}`
    : `/admin/messages?c=${conversationId}`;

  const existing = await models.Notification.findOne({
    userId: recipient.userId,
    type: NOTIFICATION_TYPES.MESSAGE,
    "metadata.conversationId": String(conversationId),
    "metadata.event": { $ne: "added" },
    readBy: { $ne: recipient.userId },
  }).sort({ createdAt: -1 });

  if (existing) {
    await models.Notification.updateOne(
      { _id: existing._id },
      {
        $set: {
          title,
          message,
          link,
          isRead: false,
          createdAt: new Date(),
          "metadata.conversationId": String(conversationId),
          "metadata.event": "message",
        },
      }
    );
    return;
  }

  await models.Notification.create({
    userId: recipient.userId,
    role: null,
    title,
    message,
    type: NOTIFICATION_TYPES.MESSAGE,
    link,
    isRead: false,
    metadata: { conversationId: String(conversationId), event: "message" },
  });
}

export async function notifyConversationEvent({
  models,
  recipientUserId,
  recipientRole,
  conversationId,
  title,
  preview,
  event,
}) {
  if (!models.Notification || !recipientUserId) return;
  const link = recipientRole === USER_ROLES.EMPLOYEE
    ? `/app/messages?c=${conversationId}`
    : `/admin/messages?c=${conversationId}`;
  const existing = await models.Notification.findOne({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.MESSAGE,
    "metadata.conversationId": String(conversationId),
    "metadata.event": event,
    readBy: { $ne: recipientUserId },
  }).sort({ createdAt: -1 });

  if (existing) {
    await models.Notification.updateOne(
      { _id: existing._id },
      {
        $set: {
          title,
          message: preview,
          link,
          isRead: false,
          createdAt: new Date(),
        },
      }
    );
    return;
  }

  await models.Notification.create({
    userId: recipientUserId,
    role: null,
    title,
    message: preview,
    type: NOTIFICATION_TYPES.MESSAGE,
    link,
    isRead: false,
    metadata: { conversationId: String(conversationId), event },
  });
}

export async function searchDirectory(req) {
  const { User, Employee } = req.auth.models;
  const search = String(req.query.search || "").trim();
  const selfId = req.auth.user._id;
  const userSelect = "fullName email role employeeId isActive";

  let users = [];
  if (!search) {
    users = await User.find({
      _id: { $ne: selfId },
      isActive: true,
      role: { $in: PORTAL_ROLES },
    })
      .select(userSelect)
      .limit(200)
      .lean();
  } else {
    const rx = new RegExp(escapeRegex(search), "i");
    const nameMatches = await User.find({
      _id: { $ne: selfId },
      isActive: true,
      role: { $in: PORTAL_ROLES },
      $or: [{ fullName: rx }, { email: rx }],
    })
      .select(userSelect)
      .limit(DIRECTORY_LIMIT)
      .lean();

    let employeeUserIds = [];
    if (Employee) {
      const employees = await Employee.find({
        status: EMPLOYEE_STATUSES.ACTIVE,
        $or: [
          { fullName: rx },
          { preferredName: rx },
          { employeeCode: rx },
          { "job.jobTitle": rx },
          { "job.department": rx },
        ],
      })
        .select("_id userId")
        .limit(DIRECTORY_LIMIT)
        .lean();
      employeeUserIds = employees.flatMap((row) => [row.userId, row._id].filter(Boolean));
    }

    const linked = employeeUserIds.length
      ? await User.find({
          _id: { $ne: selfId },
          isActive: true,
          role: { $in: PORTAL_ROLES },
          $or: [{ _id: { $in: employeeUserIds } }, { employeeId: { $in: employeeUserIds } }],
        })
          .select(userSelect)
          .lean()
      : [];

    const merged = new Map();
    for (const user of [...nameMatches, ...linked]) {
      merged.set(String(user._id), user);
    }
    users = [...merged.values()];
  }

  const employeeMap = await employeesByUser(Employee, users);
  const people = [];
  for (const user of users) {
    const employee = employeeMap.get(String(user._id));
    if (employee && employee.status === EMPLOYEE_STATUSES.INACTIVE) continue;
    const card = publicCard(user, employee);
    if (search) {
      const haystack = [card.displayName, card.employeeCode, card.jobTitle, card.department]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.toLowerCase()) && !String(user.email || "").toLowerCase().includes(search.toLowerCase())) {
        continue;
      }
    }
    people.push(card);
    if (people.length >= DIRECTORY_LIMIT) break;
  }

  people.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return people;
}

export async function assertMessagingTarget(models, actorId, participantUserId) {
  assertObjectId(participantUserId, "Choose a colleague to message.");
  if (String(participantUserId) === String(actorId)) {
    throw new HttpError(400, "You cannot start a conversation with yourself.");
  }
  const target = await loadPortalUser(models.User, participantUserId);
  if (!target) {
    throw new HttpError(404, "That person is not available in your company.");
  }
  if (target.employeeId && models.Employee) {
    const employee = await models.Employee.findById(target.employeeId).select("status").lean();
    if (employee && employee.status === EMPLOYEE_STATUSES.INACTIVE) {
      throw new HttpError(400, "That person is not available.");
    }
  }
  return target;
}

export async function openDirectConversation(req) {
  const { user, models } = req.auth;
  const participantUserId = req.body?.participantUserId;
  await assertMessagingTarget(models, user._id, participantUserId);
  const key = directKeyFor(user._id, participantUserId);

  const existing = await models.Conversation.findOne({ type: "DIRECT", directKey: key }).lean();
  if (existing) {
    return getConversation(req, existing._id);
  }

  try {
    const created = await models.Conversation.create({
      type: "DIRECT",
      directKey: key,
      createdBy: user._id,
      lastMessageAt: null,
    });
    await models.ConversationMember.create([
      { conversationId: created._id, userId: user._id, joinedAt: new Date() },
      { conversationId: created._id, userId: participantUserId, joinedAt: new Date() },
    ]);
    return getConversation(req, created._id);
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await models.Conversation.findOne({ type: "DIRECT", directKey: key }).lean();
      if (raced) return getConversation(req, raced._id);
    }
    throw error;
  }
}

async function peerFor(models, conversation, userId) {
  const other = await models.ConversationMember.findOne({
    conversationId: conversation._id,
    userId: { $ne: userId },
    leftAt: null,
  })
    .select("userId")
    .lean();
  if (!other) return null;
  const person = await models.User.findById(other.userId).select("fullName email role employeeId isActive").lean();
  if (!person) return null;
  const employeeMap = await employeesByUser(models.Employee, [person]);
  return publicCard(person, employeeMap.get(String(person._id)));
}

async function lastMessagePreview(Message, conversationId, joinedAt) {
  const message = await Message.findOne({
    conversationId,
    createdAt: { $gte: joinedAt || new Date(0) },
  }).sort({ createdAt: -1, _id: -1 }).lean();
  if (!message) return { preview: "", lastMessageAt: null, lastSenderUserId: null };
  return {
    preview: previewText(message),
    lastMessageAt: message.createdAt,
    lastSenderUserId: String(message.senderUserId),
  };
}

export async function listConversations(req) {
  const { user, models } = req.auth;
  const memberships = await models.ConversationMember.find({
    userId: user._id,
    leftAt: null,
  }).lean();
  if (memberships.length === 0) return [];

  const ids = memberships.map((member) => member.conversationId);
  const conversations = await models.Conversation.find({
    _id: { $in: ids },
  }).select("-imageData").lean();
  const byId = new Map(conversations.map((row) => [String(row._id), row]));

  const items = [];
  for (const member of memberships) {
    const conversation = byId.get(String(member.conversationId));
    if (!conversation) continue;
    const preview = await lastMessagePreview(models.Message, conversation._id, visibleSince(member));
    const unreadCount = await unreadCountForMember(models.Message, member, user._id);
    const activityAt = preview.lastMessageAt || conversation.createdAt;
    if (conversation.type === CONVERSATION_TYPES.GROUP) {
      const memberCount = await models.ConversationMember.countDocuments({
        conversationId: conversation._id,
        leftAt: null,
      });
      const admins = (conversation.adminUserIds || []).map((id) => String(id));
      items.push({
        id: String(conversation._id),
        type: conversation.type,
        name: conversation.name || "Group",
        description: conversation.description || "",
        hasImage: Boolean(conversation.imageStorageKey && conversation.imageMimeType),
        imageVersion: conversation.imageStorageKey || null,
        memberCount,
        isAdmin: admins.includes(String(user._id)),
        peer: null,
        preview: preview.preview,
        lastMessageAt: activityAt,
        lastSenderUserId: preview.lastSenderUserId,
        unreadCount,
        createdAt: conversation.createdAt,
      });
      continue;
    }
    const peer = await peerFor(models, conversation, user._id);
    items.push({
      id: String(conversation._id),
      type: conversation.type,
      peer,
      preview: preview.preview,
      lastMessageAt: activityAt,
      lastSenderUserId: preview.lastSenderUserId,
      unreadCount,
      createdAt: conversation.createdAt,
    });
  }

  items.sort((a, b) => {
    const aTime = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
  return items;
}

export async function getConversation(req, conversationId) {
  assertObjectId(conversationId, "Conversation not found");
  const { user, models } = req.auth;
  await requireActiveMember(models, conversationId, user._id);
  const conversation = await models.Conversation.findById(conversationId).select("-imageData").lean();
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.type === CONVERSATION_TYPES.GROUP) {
    const memberCount = await models.ConversationMember.countDocuments({
      conversationId: conversation._id,
      leftAt: null,
    });
    const admins = (conversation.adminUserIds || []).map((id) => String(id));
    return {
      id: String(conversation._id),
      type: conversation.type,
      name: conversation.name || "Group",
      description: conversation.description || "",
      hasImage: Boolean(conversation.imageStorageKey && conversation.imageMimeType),
      imageVersion: conversation.imageStorageKey || null,
      memberCount,
      isAdmin: admins.includes(String(user._id)),
      adminUserIds: admins,
      peer: null,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
    };
  }
  const peer = await peerFor(models, conversation, user._id);
  return {
    id: String(conversation._id),
    type: conversation.type,
    peer,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
  };
}

export async function listMessages(req, conversationId) {
  assertObjectId(conversationId, "Conversation not found");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);
  const since = visibleSince(member);

  const filter = { conversationId, createdAt: { $gte: since } };
  const before = req.query.before;
  const after = req.query.after;
  if (before && after) {
    throw new HttpError(400, "That page of messages could not be loaded.");
  }
  if (after) {
    assertObjectId(after, "That page of messages could not be loaded.");
    const cursor = await models.Message.findOne({
      _id: after,
      conversationId,
      createdAt: { $gte: since },
    }).select("_id createdAt").lean();
    if (!cursor) throw new HttpError(400, "That page of messages could not be loaded.");
    const rows = await models.Message.find({
      conversationId,
      createdAt: { $gte: since },
      $or: [
        { createdAt: { $gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
      ],
    }).sort({ createdAt: 1, _id: 1 }).limit(PAGE_SIZE + 1).lean();
    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const names = await senderNameMap(models, page);
    const quotes = await replyQuotes(models, page, since);
    return {
      messages: page.map((message) => messageDto(
        message,
        names.get(String(message.senderUserId)) || "",
        quoteFor(message, quotes),
      )),
      hasMore,
      nextBefore: null,
      nextAfter: hasMore ? String(page[page.length - 1]._id) : null,
    };
  }
  if (before) {
    assertObjectId(before, "That page of messages could not be loaded.");
    const cursor = await models.Message.findOne({
      _id: before,
      conversationId,
      createdAt: { $gte: since },
    }).select("_id").lean();
    if (!cursor) throw new HttpError(400, "That page of messages could not be loaded.");
    filter._id = { $lt: cursor._id };
  }

  const rows = await models.Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean();
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  page.reverse();
  const names = await senderNameMap(models, page);
  const quotes = await replyQuotes(models, page, since);

  return {
    messages: page.map((message) => messageDto(
      message,
      names.get(String(message.senderUserId)) || "",
      quoteFor(message, quotes),
    )),
    hasMore,
    nextBefore: hasMore ? String(page[0]._id) : null,
  };
}

function searchTokens(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && token.length <= 40))]
    .slice(0, 8);
}

function parseSearchDay(value, endOfDay) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, "Enter a valid date.");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Enter a valid date.");
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function encodeSearchCursor(createdAt, id) {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString("base64url");
}

function decodeSearchCursor(value) {
  if (value == null || value === "") return null;
  let decoded = "";
  try {
    decoded = Buffer.from(String(value), "base64url").toString("utf8");
  } catch {
    throw new HttpError(400, "That page of results could not be loaded.");
  }
  const separator = decoded.lastIndexOf("|");
  const iso = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const createdAt = new Date(iso);
  if (!iso || Number.isNaN(createdAt.getTime()) || !isStrictObjectId(id)) {
    throw new HttpError(400, "That page of results could not be loaded.");
  }
  return { createdAt, id };
}

function memberWindow(member, from, to) {
  const joined = member?.joinedAt ? new Date(member.joinedAt) : new Date(0);
  const start = from && from > joined ? from : joined;
  if (to && start > to) return null;
  const createdAt = { $gte: start };
  if (to) createdAt.$lte = to;
  return { conversationId: member.conversationId, createdAt };
}

function messageInWindow(message, clauses) {
  const clause = clauses.find((item) => String(item.conversationId) === String(message.conversationId));
  if (!clause) return false;
  const time = new Date(message.createdAt).getTime();
  if (time < new Date(clause.createdAt.$gte).getTime()) return false;
  if (clause.createdAt.$lte && time > new Date(clause.createdAt.$lte).getTime()) return false;
  return true;
}

function messageMatchesTokens(message, tokens) {
  if (tokens.length === 0) return true;
  const body = String(message.body || "").toLowerCase();
  const names = (message.attachments || []).map((file) => String(file.fileName || "").toLowerCase());
  return tokens.every((token) => body.includes(token) || names.some((name) => name.includes(token)));
}

function searchPreview(message, tokens) {
  const body = String(message.body || "");
  const names = (message.attachments || []).map((file) => String(file.fileName || "")).filter(Boolean);
  const lower = body.toLowerCase();
  let at = -1;
  let token = "";
  for (const item of tokens) {
    const found = lower.indexOf(item);
    if (found >= 0 && (at < 0 || found < at)) {
      at = found;
      token = item;
    }
  }
  if (at >= 0) {
    const start = Math.max(0, at - 40);
    const end = Math.min(body.length, at + token.length + 80);
    const preview = `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
    return { preview, match: "message", attachmentName: names[0] || "" };
  }
  const fileName = names.find((name) => tokens.some((item) => name.toLowerCase().includes(item))) || names[0] || "";
  return { preview: fileName, match: fileName ? "attachment" : "message", attachmentName: fileName };
}

async function conversationSearchLabels(models, userId, conversationIds) {
  const conversations = await models.Conversation.find({ _id: { $in: conversationIds } })
    .select("type name")
    .lean();
  const directIds = conversations.filter((conversation) => conversation.type !== CONVERSATION_TYPES.GROUP).map((conversation) => conversation._id);
  const peers = directIds.length === 0 ? [] : await models.ConversationMember.find({
    conversationId: { $in: directIds },
    userId: { $ne: userId },
    leftAt: null,
  }).select("conversationId userId").lean();
  const people = peers.length === 0 ? [] : await models.User.find({ _id: { $in: peers.map((peer) => peer.userId) } })
    .select("fullName email role employeeId")
    .lean();
  const employeeMap = await employeesByUser(models.Employee, people);
  const nameByUser = new Map(people.map((person) => [String(person._id), displayName(person, employeeMap.get(String(person._id)))]));
  const peerByConversation = new Map(peers.map((peer) => [String(peer.conversationId), nameByUser.get(String(peer.userId)) || "Colleague"]));
  const labels = new Map();
  for (const conversation of conversations) {
    const id = String(conversation._id);
    if (conversation.type === CONVERSATION_TYPES.GROUP) {
      labels.set(id, { name: conversation.name || "Group", type: CONVERSATION_TYPES.GROUP });
    } else {
      labels.set(id, { name: peerByConversation.get(id) || "Colleague", type: CONVERSATION_TYPES.DIRECT });
    }
  }
  return labels;
}

export async function searchMessages(req) {
  const { user, models } = req.auth;
  const rawQuery = String(req.query.q || "").trim();
  if (rawQuery.length > 120) throw new HttpError(400, "Search text cannot be longer than 120 characters.");
  const tokens = searchTokens(rawQuery);
  const type = String(req.query.type || "all");
  if (!["all", "direct", "group"].includes(type)) {
    throw new HttpError(400, "Choose a valid conversation type.");
  }
  const conversationId = req.query.conversationId || "";
  const senderId = req.query.senderId || "";
  const from = parseSearchDay(req.query.from, false);
  const to = parseSearchDay(req.query.to, true);
  const attachmentsOnly = req.query.attachments === "1" || req.query.attachments === "true";
  const cursor = decodeSearchCursor(req.query.cursor);
  if (from && to && to < from) throw new HttpError(400, "The end date must be on or after the start date.");
  if (from && to && to.getTime() - from.getTime() > SEARCH_RANGE_MS) {
    throw new HttpError(400, "Date range cannot be longer than a year.");
  }
  if (tokens.length === 0 && !conversationId && !senderId && !from && !to && !attachmentsOnly) {
    throw new HttpError(400, "Enter a search term or choose a filter.");
  }
  if (senderId) assertObjectId(senderId, "Choose a valid sender.");

  let memberships = await models.ConversationMember.find({ userId: user._id, leftAt: null })
    .select("conversationId joinedAt")
    .lean();
  if (conversationId) {
    assertObjectId(conversationId, "Conversation not found");
    const member = memberships.find((item) => String(item.conversationId) === String(conversationId));
    if (!member) throw new HttpError(404, "Conversation not found");
    memberships = [member];
  }
  if (type !== "all" && memberships.length > 0) {
    const wanted = type === "group" ? CONVERSATION_TYPES.GROUP : CONVERSATION_TYPES.DIRECT;
    const allowed = await models.Conversation.find({
      _id: { $in: memberships.map((member) => member.conversationId) },
      type: wanted,
    }).select("_id").lean();
    const ids = new Set(allowed.map((conversation) => String(conversation._id)));
    memberships = memberships.filter((member) => ids.has(String(member.conversationId)));
  }

  const clauses = memberships.map((member) => memberWindow(member, from, to)).filter(Boolean);
  if (clauses.length === 0) {
    return { results: [], terms: tokens, hasMore: false, nextCursor: null };
  }

  const base = [{ deletedAt: null }, { $or: clauses }];
  if (senderId) base.push({ senderUserId: new mongoose.Types.ObjectId(String(senderId)) });
  if (attachmentsOnly) base.push({ "attachments.0": { $exists: true } });

  let scanCursor = cursor;
  let scannedFull = false;
  const collected = [];
  for (let attempt = 0; attempt < SEARCH_MAX_BATCHES && collected.length <= SEARCH_PAGE_SIZE; attempt += 1) {
    const query = { $and: [...base] };
    if (tokens.length > 0) query.$text = { $search: tokens.join(" ") };
    if (scanCursor) {
      query.$and.push({
        $or: [
          { createdAt: { $lt: scanCursor.createdAt } },
          { createdAt: scanCursor.createdAt, _id: { $lt: scanCursor.id } },
        ],
      });
    }
    const batch = await models.Message.find(query)
      .select("conversationId senderUserId body attachments.fileName createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .limit(SEARCH_BATCH_SIZE)
      .lean();
    if (batch.length === 0) {
      scannedFull = false;
      break;
    }
    scannedFull = batch.length === SEARCH_BATCH_SIZE;
    const last = batch[batch.length - 1];
    scanCursor = { createdAt: last.createdAt, id: String(last._id) };
    collected.push(...batch.filter((message) => messageInWindow(message, clauses) && messageMatchesTokens(message, tokens)));
    if (!scannedFull) break;
  }

  const page = collected.slice(0, SEARCH_PAGE_SIZE);
  const hasMore = collected.length > SEARCH_PAGE_SIZE || (scannedFull && collected.length <= SEARCH_PAGE_SIZE);
  const nextSource = collected.length > SEARCH_PAGE_SIZE
    ? page[page.length - 1]
    : hasMore ? scanCursor : null;
  const names = await senderNameMap(models, page);
  const labels = await conversationSearchLabels(models, user._id, [...new Set(page.map((message) => String(message.conversationId)))]);
  return {
    results: page.map((message) => {
      const label = labels.get(String(message.conversationId)) || { name: "Conversation", type: CONVERSATION_TYPES.DIRECT };
      const preview = searchPreview(message, tokens);
      return {
        id: String(message._id),
        conversationId: String(message.conversationId),
        conversationName: label.name,
        conversationType: label.type,
        senderUserId: String(message.senderUserId),
        senderName: names.get(String(message.senderUserId)) || "",
        createdAt: message.createdAt,
        preview: preview.preview,
        match: preview.match,
        attachmentName: preview.attachmentName,
      };
    }),
    terms: tokens,
    hasMore,
    nextCursor: nextSource ? encodeSearchCursor(nextSource.createdAt, nextSource._id || nextSource.id) : null,
  };
}

export async function listMessagesAround(req, conversationId, messageId) {
  assertObjectId(conversationId, "Conversation not found");
  assertObjectId(messageId, "That message is no longer available.");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);
  const since = visibleSince(member);
  const target = await models.Message.findOne({
    _id: messageId,
    conversationId,
    createdAt: { $gte: since },
    deletedAt: null,
  }).lean();
  if (!target) throw new HttpError(404, "That message is no longer available.");

  const olderFilter = {
    conversationId,
    createdAt: { $gte: since },
    $or: [
      { createdAt: { $lt: target.createdAt } },
      { createdAt: target.createdAt, _id: { $lt: target._id } },
    ],
  };
  const newerFilter = {
    conversationId,
    createdAt: { $gte: since },
    $or: [
      { createdAt: { $gt: target.createdAt } },
      { createdAt: target.createdAt, _id: { $gt: target._id } },
    ],
  };
  const olderRows = await models.Message.find(olderFilter).sort({ createdAt: -1, _id: -1 }).limit(21).lean();
  const newerRows = await models.Message.find(newerFilter).sort({ createdAt: 1, _id: 1 }).limit(21).lean();
  const hasMoreBefore = olderRows.length > 20;
  const hasMoreAfter = newerRows.length > 20;
  const page = [
    ...(hasMoreBefore ? olderRows.slice(0, 20) : olderRows).reverse(),
    target,
    ...(hasMoreAfter ? newerRows.slice(0, 20) : newerRows),
  ];
  const names = await senderNameMap(models, page);
  const quotes = await replyQuotes(models, page, since);
  return {
    messages: page.map((message) => messageDto(
      message,
      names.get(String(message.senderUserId)) || "",
      quoteFor(message, quotes),
    )),
    hasMoreBefore,
    hasMoreAfter,
    focusId: String(target._id),
  };
}

export async function sendMessage(req, conversationId) {
  assertObjectId(conversationId, "Conversation not found");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);

  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (body.length > MESSAGE_BODY_MAX) {
    throw new HttpError(400, "Message cannot be longer than 4,000 characters.");
  }
  const attachments = await prepareMessageAttachments(req, conversationId, req.body?.attachmentIds);
  if (!body && attachments.length === 0) {
    throw new HttpError(400, "Write a message or add a file.");
  }
  const replyToMessageId = await resolveReplyTarget(models, conversationId, req.body?.replyToMessageId, visibleSince(member));

  const message = await models.Message.create({
    conversationId,
    senderUserId: user._id,
    body,
    attachments,
    replyToMessageId,
  });
  await linkMessageAttachments(models, message, user._id);
  await models.Conversation.updateOne(
    { _id: conversationId },
    { $set: { lastMessageAt: message.createdAt } }
  );

  const others = await models.ConversationMember.find({
    conversationId,
    userId: { $ne: user._id },
    leftAt: null,
  }).lean();
  const senderEmployeeMap = await employeesByUser(models.Employee, [user]);
  const senderName = displayName(user, senderEmployeeMap.get(String(user._id)));
  const preview = previewText(message);
  const conversation = await models.Conversation.findById(conversationId).select("type name").lean();
  const title = conversation?.type === CONVERSATION_TYPES.GROUP
    ? `${senderName} in ${conversation.name || "Group"}`
    : senderName;

  for (const recipient of others) {
    const account = await models.User.findById(recipient.userId).select("role isActive").lean();
    if (!account || !account.isActive) continue;
    try {
      await notifyRecipient({
        models,
        recipient: { ...recipient, role: account.role },
        senderName: title,
        conversationId,
        preview,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[chat] notification was not saved:", error.message);
      }
    }
  }

  const quotes = await replyQuotes(models, [message], visibleSince(member));
  return messageDto(message, "", quoteFor(message, quotes));
}

async function resolveReplyTarget(models, conversationId, replyToMessageId, since) {
  if (replyToMessageId == null || replyToMessageId === "") return null;
  assertObjectId(replyToMessageId, "Reply to a message in this conversation.");
  const original = await models.Message.findOne({ _id: replyToMessageId, conversationId }).select("createdAt deletedAt").lean();
  if (!original) throw new HttpError(400, "Reply to a message in this conversation.");
  if (new Date(original.createdAt) < since) throw new HttpError(404, "That message is not available.");
  if (original.deletedAt) throw new HttpError(400, "That message was deleted.");
  return original._id;
}

async function replyQuotes(models, messages, since) {
  const ids = [...new Set(messages.map((message) => message.replyToMessageId).filter(Boolean).map(String))];
  const quotes = new Map();
  if (ids.length === 0) return quotes;
  const originals = await models.Message.find({ _id: { $in: ids } }).lean();
  const names = await senderNameMap(models, originals);
  const conversationId = String(messages[0]?.conversationId || "");
  for (const original of originals) {
    const sameConversation = String(original.conversationId) === conversationId;
    const visible = sameConversation && new Date(original.createdAt) >= since;
    if (!visible) {
      quotes.set(String(original._id), { id: String(original._id), available: false, deleted: false, senderName: "", preview: "" });
      continue;
    }
    quotes.set(String(original._id), {
      id: String(original._id),
      available: true,
      deleted: Boolean(original.deletedAt),
      senderName: names.get(String(original.senderUserId)) || "",
      preview: original.deletedAt ? "" : previewText(original),
    });
  }
  return quotes;
}

function quoteFor(message, quotes) {
  if (!message?.replyToMessageId) return null;
  return quotes.get(String(message.replyToMessageId)) || {
    id: String(message.replyToMessageId),
    available: false,
    deleted: false,
    senderName: "",
    preview: "",
  };
}

async function loadOwnMessage(req, conversationId, messageId) {
  assertObjectId(conversationId, "Conversation not found");
  assertObjectId(messageId, "Message not found");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);
  const message = await models.Message.findOne({
    _id: messageId,
    conversationId,
    createdAt: { $gte: visibleSince(member) },
  });
  if (!message) throw new HttpError(404, "Message not found");
  if (String(message.senderUserId) !== String(user._id)) {
    throw new HttpError(403, "You can only change your own messages.");
  }
  return { message, member, models, user };
}

async function syncUnreadNotificationPreview(models, conversationId) {
  if (!models.Notification) return;
  const notes = await models.Notification.find({
    type: NOTIFICATION_TYPES.MESSAGE,
    "metadata.conversationId": String(conversationId),
    "metadata.event": { $ne: "added" },
    isRead: false,
  }).select("_id userId message");
  for (const note of notes) {
    const member = await models.ConversationMember.findOne({
      conversationId,
      userId: note.userId,
      leftAt: null,
    }).lean();
    if (!member) continue;
    const latest = await models.Message.findOne({
      conversationId,
      createdAt: { $gte: visibleSince(member) },
    }).sort({ createdAt: -1, _id: -1 }).lean();
    const preview = latest ? previewText(latest) : "You have a new message.";
    if (note.message !== preview) {
      await models.Notification.updateOne({ _id: note._id }, { $set: { message: preview } });
    }
  }
}

export async function editMessage(req, conversationId, messageId) {
  const { message, member, models } = await loadOwnMessage(req, conversationId, messageId);
  if (message.deletedAt) throw new HttpError(400, "This message was deleted.");
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (body.length > MESSAGE_BODY_MAX) {
    throw new HttpError(400, "Message cannot be longer than 4,000 characters.");
  }
  if (!body && (message.attachments || []).length === 0) {
    throw new HttpError(400, "Write a message or add a file.");
  }
  message.body = body;
  message.editedAt = new Date();
  await message.save();
  await syncUnreadNotificationPreview(models, conversationId);
  const quotes = await replyQuotes(models, [message], visibleSince(member));
  return messageDto(message, "", quoteFor(message, quotes));
}

export async function deleteMessage(req, conversationId, messageId) {
  const { message, member, models } = await loadOwnMessage(req, conversationId, messageId);
  if (!message.deletedAt) {
    message.deletedAt = new Date();
    message.body = "";
    await message.save();
    await releaseMessageAttachments(models, message);
    await syncUnreadNotificationPreview(models, conversationId);
  }
  const quotes = await replyQuotes(models, [message], visibleSince(member));
  return messageDto(message, "", quoteFor(message, quotes));
}

export async function markConversationRead(req, conversationId) {
  assertObjectId(conversationId, "Conversation not found");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);
  const latest = await models.Message.findOne({
    conversationId,
    createdAt: { $gte: visibleSince(member) },
  }).sort({ createdAt: -1, _id: -1 }).select("_id createdAt").lean();
  const now = new Date();
  await models.ConversationMember.updateOne(
    { _id: member._id },
    {
      $set: {
        lastReadAt: now,
        lastReadMessageId: latest?._id || member.lastReadMessageId || null,
      },
    }
  );

  if (models.Notification) {
    await models.Notification.updateMany(
      {
        userId: user._id,
        type: NOTIFICATION_TYPES.MESSAGE,
        "metadata.conversationId": String(conversationId),
      },
      { $addToSet: { readBy: user._id }, $set: { isRead: true } }
    );
  }

  return { conversationId: String(conversationId), lastReadAt: now };
}

export async function unreadTotal(req) {
  const { user, models } = req.auth;
  const memberships = await models.ConversationMember.find({
    userId: user._id,
    leftAt: null,
  }).lean();
  let total = 0;
  for (const member of memberships) {
    total += await unreadCountForMember(models.Message, member, user._id);
  }
  return { unreadCount: total };
}
