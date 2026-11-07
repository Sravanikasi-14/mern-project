import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext } from "../middleware/hrAccessEnforcement.js";
import { handleChat, handleChatStream, getChatStatus } from "../controllers/chatbotController.js";

const router = Router();

// All chat endpoints require authenticated session + HR access context (no-op when OFF / non-HR)
router.use(authenticate, loadHrAccessContext);

router.get("/status", getChatStatus);
router.post("/message", handleChat);
router.post("/stream", handleChatStream);
router.post("/", handleChat);

export default router;
