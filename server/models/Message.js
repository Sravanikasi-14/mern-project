import mongoose from "mongoose";

export const MESSAGE_BODY_MAX = 4000;

export function createMessageSchema() {
  const schema = new mongoose.Schema(
    {
      conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
      },
      senderUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      replyToMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null,
      },
      body: {
        type: String,
        trim: true,
        maxlength: MESSAGE_BODY_MAX,
        default: "",
      },
      editedAt: {
        type: Date,
        default: null,
      },
      deletedAt: {
        type: Date,
        default: null,
      },
      attachments: {
        type: [
          {
            fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
            fileName: { type: String, required: true, maxlength: 180 },
            mimeType: { type: String, required: true, maxlength: 160 },
            size: { type: Number, required: true, min: 1 },
            storageKey: { type: String, required: true, maxlength: 512 },
            uploadedAt: { type: Date, required: true },
            uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          },
        ],
        default: [],
      },
    },
    {
      timestamps: true,
      collection: "messages",
    }
  );

  schema.index({ conversationId: 1, createdAt: 1, _id: 1 });
  schema.index(
    { body: "text", "attachments.fileName": "text" },
    {
      name: "message_text_search",
      default_language: "none",
      weights: { body: 5, "attachments.fileName": 5 },
    }
  );

  return schema;
}

export function getMessageModel(connection) {
  return connection.models.Message || connection.model("Message", createMessageSchema());
}
