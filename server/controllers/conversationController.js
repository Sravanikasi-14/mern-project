import {
  addGroupMembers,
  createGroup,
  demoteGroupAdmin,
  leaveGroup,
  listGroupMembers,
  promoteGroupAdmin,
  readGroupImage,
  removeGroupMember,
  transferGroupAdmin,
  updateGroup,
} from "../services/conversationGroupService.js";
import {
  contentDisposition,
  discardConversationFile,
  readMessageAttachment,
  uploadConversationFile,
} from "../services/chatAttachmentService.js";
import {
  getConversation,
  listConversations,
  deleteMessage,
  editMessage,
  listMessages,
  listMessagesAround,
  markConversationRead,
  openDirectConversation,
  searchDirectory,
  searchMessages,
  sendMessage,
  unreadTotal,
} from "../services/conversationService.js";

export async function getDirectory(req, res, next) {
  try {
    const people = await searchDirectory(req);
    res.json({ success: true, people });
  } catch (error) {
    next(error);
  }
}

export async function getConversations(req, res, next) {
  try {
    const conversations = await listConversations(req);
    res.json({ success: true, conversations });
  } catch (error) {
    next(error);
  }
}

export async function postConversation(req, res, next) {
  try {
    const conversation = await openDirectConversation(req);
    res.status(200).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function getConversationById(req, res, next) {
  try {
    const conversation = await getConversation(req, req.params.id);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function getMessageSearch(req, res, next) {
  try {
    const search = await searchMessages(req);
    res.json({ success: true, ...search });
  } catch (error) {
    next(error);
  }
}

export async function getMessagesAround(req, res, next) {
  try {
    const page = await listMessagesAround(req, req.params.id, req.params.messageId);
    res.json({ success: true, ...page });
  } catch (error) {
    next(error);
  }
}

export async function getMessages(req, res, next) {
  try {
    const page = await listMessages(req, req.params.id);
    res.json({ success: true, ...page });
  } catch (error) {
    next(error);
  }
}

export async function postMessage(req, res, next) {
  try {
    const message = await sendMessage(req, req.params.id);
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
}

export async function patchMessage(req, res, next) {
  try {
    const message = await editMessage(req, req.params.id, req.params.messageId);
    res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
}

export async function removeMessage(req, res, next) {
  try {
    const message = await deleteMessage(req, req.params.id, req.params.messageId);
    res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
}

export async function postRead(req, res, next) {
  try {
    const read = await markConversationRead(req, req.params.id);
    res.json({ success: true, ...read });
  } catch (error) {
    next(error);
  }
}

export async function postGroup(req, res, next) {
  try {
    const conversation = await createGroup(req);
    res.status(201).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function patchGroup(req, res, next) {
  try {
    const conversation = await updateGroup(req, req.params.id);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function getGroupMembers(req, res, next) {
  try {
    const result = await listGroupMembers(req, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function postGroupMembers(req, res, next) {
  try {
    const conversation = await addGroupMembers(req, req.params.id);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function deleteGroupMember(req, res, next) {
  try {
    const result = await removeGroupMember(req, req.params.id, req.params.userId);
    res.json({ success: true, ...(result.left ? result : { conversation: result }) });
  } catch (error) {
    next(error);
  }
}

export async function postLeaveGroup(req, res, next) {
  try {
    const result = await leaveGroup(req, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function postGroupAdmin(req, res, next) {
  try {
    const conversation = await promoteGroupAdmin(req, req.params.id);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function deleteGroupAdmin(req, res, next) {
  try {
    const conversation = await demoteGroupAdmin(req, req.params.id, req.params.userId);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function postTransferAdmin(req, res, next) {
  try {
    const conversation = await transferGroupAdmin(req, req.params.id);
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
}

export async function getGroupImage(req, res, next) {
  try {
    const image = await readGroupImage(req, req.params.id);
    res.set("Content-Type", image.mimeType);
    res.set("Cache-Control", "private, max-age=60");
    res.status(200).end(image.data);
  } catch (error) {
    next(error);
  }
}

export async function postAttachment(req, res, next) {
  try {
    const file = await uploadConversationFile(req, req.params.id);
    res.status(201).json({ success: true, file });
  } catch (error) {
    next(error);
  }
}

export async function deleteAttachment(req, res, next) {
  try {
    const result = await discardConversationFile(req, req.params.id, req.params.fileId);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getMessageAttachment(req, res, next) {
  try {
    const file = await readMessageAttachment(req, req.params.id, req.params.messageId, req.params.fileId);
    const inline = String(file.mimeType || "").startsWith("image/");
    res.set("Content-Type", file.mimeType);
    res.set("Content-Length", String(file.body.length));
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", contentDisposition(file.fileName, inline));
    res.status(200).end(file.body);
  } catch (error) {
    next(error);
  }
}

export async function getUnreadCount(req, res, next) {
  try {
    const summary = await unreadTotal(req);
    res.json({ success: true, ...summary });
  } catch (error) {
    next(error);
  }
}
