import mongoose from "mongoose";
import { CONVERSATION_TYPES, GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX } from "../models/Conversation.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { saveChatImageFile } from "./documentStorage.js";
import { connectionSupportsTransactions } from "./onboardingEmployeeService.js";
import {
  assertMessagingTarget,
  assertObjectId,
  displayName,
  employeesByUser,
  getConversation,
  loadPortalUser,
  notifyConversationEvent,
  publicCard,
  requireActiveMember,
} from "./conversationService.js";
import { HttpError } from "../utils/httpError.js";

const MEMBER_BATCH_MAX = 50;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertGroupName(name) {
  if (!name) throw new HttpError(400, "Enter a group name.");
  if (name.length > GROUP_NAME_MAX) {
    throw new HttpError(400, `Group name cannot be longer than ${GROUP_NAME_MAX} characters.`);
  }
  return name;
}

function assertDescription(description) {
  if (description.length > GROUP_DESCRIPTION_MAX) {
    throw new HttpError(400, `Description cannot be longer than ${GROUP_DESCRIPTION_MAX} characters.`);
  }
  return description;
}

function idList(value) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))];
}

function adminIds(conversation) {
  return (conversation?.adminUserIds || []).map((id) => String(id));
}

function isAdmin(conversation, userId) {
  return adminIds(conversation).includes(String(userId));
}

async function withOptionalTransaction(connection, work) {
  if (!connectionSupportsTransactions(connection)) {
    return work(null);
  }
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function optionalImage(company, image) {
  if (image == null || image === "") return null;
  if (typeof image !== "object" || Array.isArray(image)) {
    throw new HttpError(400, "Choose a group image.");
  }
  if (!image.fileName && !image.fileData) return null;
  return saveChatImageFile({
    databaseName: company?.databaseName || "company",
    fileName: image.fileName,
    fileData: image.fileData,
    mimeType: image.mimeType,
  });
}

async function requireGroup(models, conversationId, userId) {
  assertObjectId(conversationId, "Conversation not found");
  const member = await requireActiveMember(models, conversationId, userId);
  const conversation = await models.Conversation.findById(conversationId).select("-imageData");
  if (!conversation || conversation.type !== CONVERSATION_TYPES.GROUP) {
    throw new HttpError(conversation ? 400 : 404, conversation ? "This conversation is not a group." : "Conversation not found");
  }
  return { member, conversation };
}

async function requireGroupAdmin(models, conversationId, userId) {
  const loaded = await requireGroup(models, conversationId, userId);
  if (!isAdmin(loaded.conversation, userId)) {
    throw new HttpError(403, "Only group admins can change this group.");
  }
  return loaded;
}

async function activePortalOrThrow(models, userId) {
  const account = await loadPortalUser(models.User, userId);
  if (!account) return null;
  if (account.employeeId && models.Employee) {
    const employee = await models.Employee.findById(account.employeeId).select("status").lean();
    if (employee && employee.status === EMPLOYEE_STATUSES.INACTIVE) return null;
  }
  return account;
}

async function pickSuccessor(models, conversationId, actorId) {
  const others = await models.ConversationMember.find({
    conversationId,
    userId: { $ne: actorId },
    leftAt: null,
  }).sort({ joinedAt: 1, userId: 1 }).lean();
  for (const member of others) {
    const account = await activePortalOrThrow(models, member.userId);
    if (account) return member.userId;
  }
  return others.length > 0 ? false : null;
}

async function notifyAdded(models, actor, conversation, recipientIds) {
  const actorEmployees = await employeesByUser(models.Employee, [actor]);
  const actorName = displayName(actor, actorEmployees.get(String(actor._id)));
  const title = conversation.name || "Group";
  for (const recipientUserId of recipientIds) {
    const account = await models.User.findById(recipientUserId).select("role isActive").lean();
    if (!account?.isActive) continue;
    try {
      await notifyConversationEvent({
        models,
        recipientUserId,
        recipientRole: account.role,
        conversationId: conversation._id,
        title,
        preview: `${actorName} added you to ${title}.`,
        event: "added",
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[chat] group notification was not saved:", error.message);
      }
    }
  }
}

async function memberCards(models, conversation) {
  const memberships = await models.ConversationMember.find({
    conversationId: conversation._id,
    leftAt: null,
  }).sort({ joinedAt: 1 }).lean();
  const users = await models.User.find({
    _id: { $in: memberships.map((member) => member.userId) },
  }).select("fullName email role employeeId isActive").lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const employeeMap = await employeesByUser(models.Employee, users);
  const admins = new Set(adminIds(conversation));
  return memberships
    .map((member) => {
      const account = byId.get(String(member.userId));
      if (!account) return null;
      return {
        ...publicCard(account, employeeMap.get(String(account._id))),
        isAdmin: admins.has(String(member.userId)),
        joinedAt: member.joinedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.displayName.localeCompare(b.displayName));
}

export async function createGroup(req) {
  const { user, models, company } = req.auth;
  const name = assertGroupName(cleanText(req.body?.name));
  const description = assertDescription(cleanText(req.body?.description));
  const requested = idList(req.body?.memberUserIds).filter((id) => id !== String(user._id));
  if (requested.length === 0) throw new HttpError(400, "Add at least one other person.");
  if (requested.length > MEMBER_BATCH_MAX) {
    throw new HttpError(400, `Add up to ${MEMBER_BATCH_MAX} people at a time.`);
  }
  for (const participantUserId of requested) {
    await assertMessagingTarget(models, user._id, participantUserId);
  }
  const image = await optionalImage(company, req.body?.image);
  const now = new Date();
  const memberDocs = [
    { userId: user._id, joinedAt: now },
    ...requested.map((id, index) => ({ userId: id, joinedAt: new Date(now.getTime() + index + 1) })),
  ];

  const conversationId = await withOptionalTransaction(models.Conversation.db, async (session) => {
    const options = session ? { session } : undefined;
    const createdList = await models.Conversation.create([{
      type: CONVERSATION_TYPES.GROUP,
      directKey: null,
      name,
      description,
      createdBy: user._id,
      adminUserIds: [user._id],
      imageStorageKey: image?.storageKey || null,
      imageMimeType: image?.mimeType || null,
      imageData: image?.fileBuffer,
      lastMessageAt: null,
    }], options);
    const created = createdList[0];
    try {
      await models.ConversationMember.create(
        memberDocs.map((member) => ({
          conversationId: created._id,
          userId: member.userId,
          joinedAt: member.joinedAt,
        })),
        options
      );
    } catch (error) {
      if (!session) {
        await models.ConversationMember.deleteMany({ conversationId: created._id });
        await models.Conversation.deleteOne({ _id: created._id });
      }
      throw error;
    }
    return created._id;
  });

  const conversation = await models.Conversation.findById(conversationId).select("name").lean();
  await notifyAdded(models, user, { _id: conversationId, name: conversation?.name || name }, requested);
  return getConversation(req, conversationId);
}

export async function updateGroup(req, conversationId) {
  const { user, models, company } = req.auth;
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
    changes.name = assertGroupName(cleanText(req.body.name));
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "description")) {
    changes.description = assertDescription(cleanText(req.body.description));
  }
  if (req.body?.removeImage === true) {
    changes.imageStorageKey = null;
    changes.imageMimeType = null;
    changes.imageData = null;
  }
  if (req.body?.image) {
    const image = await optionalImage(company, req.body.image);
    if (image) {
      changes.imageStorageKey = image.storageKey;
      changes.imageMimeType = image.mimeType;
      changes.imageData = image.fileBuffer;
    }
  }
  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, "Nothing to update.");
  }
  await models.Conversation.updateOne({ _id: conversation._id }, { $set: changes });
  return getConversation(req, conversation._id);
}

export async function listGroupMembers(req, conversationId) {
  const { user, models } = req.auth;
  const { conversation } = await requireGroup(models, conversationId, user._id);
  const members = await memberCards(models, conversation);
  return { members };
}

export async function addGroupMembers(req, conversationId) {
  const { user, models } = req.auth;
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  const requested = idList(req.body?.userIds || req.body?.memberUserIds).filter((id) => id !== String(user._id));
  if (requested.length === 0) throw new HttpError(400, "Choose a colleague to add.");
  if (requested.length > MEMBER_BATCH_MAX) {
    throw new HttpError(400, `Add up to ${MEMBER_BATCH_MAX} people at a time.`);
  }

  const plans = [];
  for (const participantUserId of requested) {
    await assertMessagingTarget(models, user._id, participantUserId);
    const existing = await models.ConversationMember.findOne({
      conversationId: conversation._id,
      userId: participantUserId,
    });
    if (existing && !existing.leftAt) {
      throw new HttpError(409, "That person is already in this group.");
    }
    plans.push({ userId: participantUserId, existing });
  }

  const now = new Date();
  const touched = [];
  try {
    await withOptionalTransaction(models.Conversation.db, async (session) => {
      for (const plan of plans) {
        if (plan.existing) {
          const previous = {
            leftAt: plan.existing.leftAt,
            joinedAt: plan.existing.joinedAt,
            lastReadAt: plan.existing.lastReadAt,
            lastReadMessageId: plan.existing.lastReadMessageId,
          };
          await models.ConversationMember.updateOne(
            { _id: plan.existing._id },
            {
              $set: {
                leftAt: null,
                joinedAt: now,
                lastReadAt: null,
                lastReadMessageId: null,
              },
            },
            session ? { session } : undefined
          );
          touched.push({ mode: "update", id: plan.existing._id, previous });
        } else {
          const created = await models.ConversationMember.create([{
            conversationId: conversation._id,
            userId: plan.userId,
            joinedAt: now,
          }], session ? { session } : undefined);
          touched.push({ mode: "insert", id: created[0]._id });
        }
      }
    });
  } catch (error) {
    if (!connectionSupportsTransactions(models.Conversation.db)) {
      for (const item of touched.reverse()) {
        if (item.mode === "insert") {
          await models.ConversationMember.deleteOne({ _id: item.id });
        } else {
          await models.ConversationMember.updateOne({ _id: item.id }, { $set: item.previous });
        }
      }
    }
    if (error?.code === 11000) {
      throw new HttpError(409, "That person is already in this group.");
    }
    throw error;
  }

  await notifyAdded(models, user, conversation, requested);
  return getConversation(req, conversation._id);
}

export async function removeGroupMember(req, conversationId, targetUserId) {
  const { user, models } = req.auth;
  assertObjectId(targetUserId, "That person is not in this group.");
  if (String(targetUserId) === String(user._id)) {
    return leaveGroup(req, conversationId);
  }
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  const target = await models.ConversationMember.findOne({
    conversationId: conversation._id,
    userId: targetUserId,
    leftAt: null,
  });
  if (!target) throw new HttpError(404, "That person is not in this group.");
  const admins = adminIds(conversation);
  if (admins.includes(String(targetUserId)) && admins.length < 2) {
    throw new HttpError(400, "Transfer administration before removing the last admin.");
  }

  const now = new Date();
  await models.ConversationMember.updateOne({ _id: target._id }, { $set: { leftAt: now } });
  try {
    if (admins.includes(String(targetUserId))) {
      await models.Conversation.updateOne(
        { _id: conversation._id },
        { $pull: { adminUserIds: new mongoose.Types.ObjectId(String(targetUserId)) } }
      );
    }
  } catch (error) {
    await models.ConversationMember.updateOne({ _id: target._id }, { $set: { leftAt: null } });
    throw error;
  }
  return getConversation(req, conversation._id);
}

export async function leaveGroup(req, conversationId) {
  const { user, models } = req.auth;
  const { member, conversation } = await requireGroup(models, conversationId, user._id);
  const admins = adminIds(conversation);
  const wasAdmin = admins.includes(String(user._id));
  let nextAdmins = admins.filter((id) => id !== String(user._id));
  let transferredTo = null;

  if (wasAdmin && nextAdmins.length === 0) {
    const successor = await pickSuccessor(models, conversation._id, user._id);
    if (successor === false) {
      throw new HttpError(400, "Add an active colleague before leaving this group.");
    }
    if (successor) {
      transferredTo = String(successor);
      nextAdmins = [transferredTo];
    }
  }

  const previousAdmins = conversation.adminUserIds;
  await models.Conversation.updateOne(
    { _id: conversation._id },
    { $set: { adminUserIds: nextAdmins } }
  );
  try {
    await models.ConversationMember.updateOne(
      { _id: member._id },
      { $set: { leftAt: new Date() } }
    );
  } catch (error) {
    await models.Conversation.updateOne(
      { _id: conversation._id },
      { $set: { adminUserIds: previousAdmins } }
    );
    throw error;
  }

  return {
    left: true,
    conversationId: String(conversation._id),
    transferredTo,
  };
}

export async function promoteGroupAdmin(req, conversationId) {
  const { user, models } = req.auth;
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  const targetUserId = req.body?.userId;
  assertObjectId(targetUserId, "Choose a group member.");
  const membership = await models.ConversationMember.findOne({
    conversationId: conversation._id,
    userId: targetUserId,
    leftAt: null,
  }).lean();
  if (!membership) throw new HttpError(404, "That person is not in this group.");
  await models.Conversation.updateOne(
    { _id: conversation._id },
    { $addToSet: { adminUserIds: new mongoose.Types.ObjectId(String(targetUserId)) } }
  );
  return getConversation(req, conversation._id);
}

export async function demoteGroupAdmin(req, conversationId, targetUserId) {
  const { user, models } = req.auth;
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  assertObjectId(targetUserId, "That person is not a group admin.");
  const admins = adminIds(conversation);
  if (!admins.includes(String(targetUserId))) {
    throw new HttpError(400, "That person is not a group admin.");
  }
  if (admins.length < 2) {
    throw new HttpError(400, "Choose another admin before removing this one.");
  }
  const updated = await models.Conversation.findOneAndUpdate(
    { _id: conversation._id, adminUserIds: targetUserId, "adminUserIds.1": { $exists: true } },
    { $pull: { adminUserIds: new mongoose.Types.ObjectId(String(targetUserId)) } },
    { returnDocument: "after" }
  );
  if (!updated) {
    throw new HttpError(409, "Group admins changed. Refresh and try again.");
  }
  return getConversation(req, conversation._id);
}

export async function transferGroupAdmin(req, conversationId) {
  const { user, models } = req.auth;
  const { conversation } = await requireGroupAdmin(models, conversationId, user._id);
  const targetUserId = req.body?.userId;
  assertObjectId(targetUserId, "Choose a group member.");
  if (String(targetUserId) === String(user._id)) {
    throw new HttpError(400, "Choose another person to administer the group.");
  }
  const membership = await models.ConversationMember.findOne({
    conversationId: conversation._id,
    userId: targetUserId,
    leftAt: null,
  }).lean();
  if (!membership) throw new HttpError(404, "That person is not in this group.");
  const next = adminIds(conversation).filter((id) => id !== String(user._id));
  if (!next.includes(String(targetUserId))) next.push(String(targetUserId));
  await models.Conversation.updateOne(
    { _id: conversation._id },
    { $set: { adminUserIds: next } }
  );
  return getConversation(req, conversation._id);
}

export async function readGroupImage(req, conversationId) {
  const { user, models } = req.auth;
  assertObjectId(conversationId, "Conversation not found");
  await requireActiveMember(models, conversationId, user._id);
  const conversation = await models.Conversation.findById(conversationId)
    .select("type imageData imageMimeType imageStorageKey")
    .lean();
  if (!conversation || conversation.type !== CONVERSATION_TYPES.GROUP || !conversation.imageData) {
    throw new HttpError(404, "Image not found");
  }
  const data = Buffer.isBuffer(conversation.imageData)
    ? conversation.imageData
    : Buffer.from(conversation.imageData.buffer || conversation.imageData);
  return {
    data,
    mimeType: conversation.imageMimeType || "application/octet-stream",
  };
}
