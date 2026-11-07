import { Router } from "express";
import {
  deleteGroupAdmin,
  deleteGroupMember,
  getConversationById,
  getConversations,
  getDirectory,
  deleteAttachment,
  getGroupImage,
  getGroupMembers,
  getMessageAttachment,
  getMessages,
  getMessagesAround,
  getMessageSearch,
  getUnreadCount,
  patchMessage,
  patchGroup,
  postAttachment,
  postConversation,
  postGroup,
  postGroupAdmin,
  postGroupMembers,
  postLeaveGroup,
  postMessage,
  postRead,
  postTransferAdmin,
  removeMessage,
} from "../controllers/conversationController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

router.use(authenticate);

router.get("/directory", getDirectory);
router.get("/search", getMessageSearch);
router.get("/unread-count", getUnreadCount);
router.get("/", getConversations);
router.post("/groups", postGroup);
router.post("/", postConversation);
router.post("/:id/attachments", postAttachment);
router.delete("/:id/attachments/:fileId", deleteAttachment);
router.get("/:id/messages/:messageId/attachments/:fileId", getMessageAttachment);
router.get("/:id/messages/around/:messageId", getMessagesAround);
router.get("/:id/messages", getMessages);
router.post("/:id/messages", postMessage);
router.patch("/:id/messages/:messageId", patchMessage);
router.delete("/:id/messages/:messageId", removeMessage);
router.post("/:id/read", postRead);
router.get("/:id/members", getGroupMembers);
router.post("/:id/members", postGroupMembers);
router.delete("/:id/members/:userId", deleteGroupMember);
router.post("/:id/leave", postLeaveGroup);
router.post("/:id/admins/transfer", postTransferAdmin);
router.post("/:id/admins", postGroupAdmin);
router.delete("/:id/admins/:userId", deleteGroupAdmin);
router.get("/:id/image", getGroupImage);
router.patch("/:id", patchGroup);
router.get("/:id", getConversationById);

export default router;
