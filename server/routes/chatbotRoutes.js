import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { handleChat, handleChatStream, getChatStatus } from "../controllers/chatbotController.js";

const router = Router();

// All chat endpoints require authenticated session
router.use(authenticate);

router.get("/status", getChatStatus);
router.post("/message", handleChat);
router.post("/stream", handleChatStream);
router.post("/", handleChat);

export default router;
