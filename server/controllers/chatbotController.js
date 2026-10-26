import { sendChatMessage, streamChatMessage } from "../services/chatbotService.js";
import { DEFAULT_GEMINI_MODEL } from "../config/gemini.js";

/**
 * Standard JSON Chatbot message processing endpoint with timeout protection.
 * If stream is requested via query, body, or accept header, delegates to handleChatStream.
 */
export async function handleChat(req, res, next) {
  // If streaming requested, delegate to streaming handler
  if (
    req.body?.stream === true ||
    req.query?.stream === "true" ||
    req.headers?.accept?.includes("text/event-stream")
  ) {
    return handleChatStream(req, res, next);
  }

  const abortController = new AbortController();
  const timeoutMs = parseInt(process.env.CHAT_TIMEOUT_MS, 10) || 75000;
  let isTimedOut = false;

  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    abortController.abort(new Error("Request timeout"));
  }, timeoutMs);

  const onClose = () => {
    if (!res.writableFinished) {
      abortController.abort(new Error("Client disconnected"));
    }
  };

  res.on("close", onClose);

  try {
    if (!req.auth || !req.auth.user || !req.auth.models) {
      clearTimeout(timeoutId);
      res.off?.("close", onClose);
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication is required to use the chat assistant.",
      });
    }

    const { message, history } = req.body || {};

    const result = await sendChatMessage({
      models: req.auth.models,
      user: req.auth.user,
      company: req.auth.company,
      message,
      history,
      abortSignal: abortController.signal,
    });

    clearTimeout(timeoutId);
    res.off?.("close", onClose);

    if (res.writableEnded) return;

    return res.status(200).json({
      success: true,
      reply: result.reply,
      model: result.model,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    res.off?.("close", onClose);

    if (res.writableEnded) return;

    const status = isTimedOut ? 504 : error.status || (error.statusCode ? error.statusCode : 500);
    let message = isTimedOut
      ? "The AI assistant took too long to respond (timeout). Please try again with a shorter message."
      : error.message || "An unexpected error occurred while communicating with the AI service.";

    // Unpack Google API JSON error if embedded in error message
    if (typeof message === "string") {
      try {
        const jsonMatch = message.match(/\{[\s\S]*"error"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed?.error?.message) {
            message = `Gemini AI Error: ${parsed.error.message}`;
          }
        }
      } catch {
        // Fallback to error message
      }
    }

    const code =
      status === 504
        ? "GATEWAY_TIMEOUT"
        : error.code ||
          (status === 503
            ? "SERVICE_UNAVAILABLE"
            : status === 429
            ? "RATE_LIMITED"
            : status >= 500
            ? "AI_SERVICE_ERROR"
            : "VALIDATION_ERROR");

    return res.status(status).json({
      success: false,
      code,
      message,
    });
  }
}

/**
 * Server-Sent Events (SSE) streaming chat endpoint.
 * Provides immediate connection acknowledgement and incremental token delivery.
 */
export async function handleChatStream(req, res, next) {
  if (!req.auth || !req.auth.user || !req.auth.models) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Authentication is required to use the chat assistant.",
    });
  }

  const { message, history } = req.body || {};
  const abortController = new AbortController();
  const streamTimeoutMs = parseInt(process.env.CHAT_STREAM_TIMEOUT_MS, 10) || 75000;

  let streamTimer = setTimeout(() => {
    abortController.abort(new Error("Stream timeout"));
  }, streamTimeoutMs);

  const resetTimer = () => {
    clearTimeout(streamTimer);
    streamTimer = setTimeout(() => {
      abortController.abort(new Error("Stream chunk timeout"));
    }, 35000);
  };

  const onClose = () => {
    if (!res.writableFinished) {
      clearTimeout(streamTimer);
      abortController.abort(new Error("Client disconnected"));
    }
  };

  res.on("close", onClose);

  // Set SSE response headers immediately
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send immediate comment ping so client DevTools exits 'Pending' state instantly
  res.write(": connected\n\n");
  if (typeof res.flush === "function") res.flush();

  try {
    for await (const chunk of streamChatMessage({
      models: req.auth.models,
      user: req.auth.user,
      company: req.auth.company,
      message,
      history,
      abortSignal: abortController.signal,
    })) {
      resetTimer();
      res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
      if (typeof res.flush === "function") res.flush();
    }

    clearTimeout(streamTimer);
    res.write(
      `event: done\ndata: ${JSON.stringify({ model: DEFAULT_GEMINI_MODEL })}\n\n`
    );
    res.end();
  } catch (error) {
    clearTimeout(streamTimer);

    let cleanMessage =
      abortController.signal.aborted
        ? "AI stream response timed out or was cancelled."
        : error?.message || "An unexpected error occurred while streaming.";

    try {
      const jsonMatch = cleanMessage.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error?.message) {
          cleanMessage = parsed.error.message;
        }
      }
    } catch {
      // Fallback
    }

    res.write(
      `event: error\ndata: ${JSON.stringify({ message: cleanMessage })}\n\n`
    );
    res.end();
  }
}

/**
 * Returns chatbot status and active model without exposing API keys.
 */
export async function getChatStatus(req, res, next) {
  try {
    const isConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());

    res.status(200).json({
      success: true,
      isConfigured,
      model: DEFAULT_GEMINI_MODEL,
    });
  } catch (error) {
    next(error);
  }
}
