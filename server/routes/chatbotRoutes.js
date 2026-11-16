import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext } from "../middleware/hrAccessEnforcement.js";
import { handleChat, handleChatStream, getChatStatus } from "../controllers/chatbotController.js";

const router = Router();

/**
 * Ask-AI assistant endpoints — intentionally NOT gated by Platform Admin module catalogue.
 * See platformFeatureCatalog.js header (Ask-AI chatbot exclusion). Auth + session only.
 * Do not confuse with /api/conversations (messaging), which uses the `chat` module.
 */
router.use(authenticate, loadHrAccessContext);

router.get("/status", getChatStatus);
router.post("/message", handleChat);
router.post("/stream", handleChatStream);
router.post("/", handleChat);

export default router;
