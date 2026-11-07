import mongoose from "mongoose";

export function createChatFileSchema() {
  const schema = new mongoose.Schema(
    {
      conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
      },
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null,
      },
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      fileName: { type: String, required: true, maxlength: 180 },
      mimeType: { type: String, required: true, maxlength: 160 },
      size: { type: Number, required: true, min: 1 },
      storageKey: { type: String, required: true, maxlength: 512 },
    },
    {
      timestamps: true,
      collection: "chat_files",
    }
  );

  schema.index({ conversationId: 1, uploadedBy: 1, messageId: 1 });
  schema.index({ messageId: 1 });

  return schema;
}

export function getChatFileModel(connection) {
  return connection.models.ChatFile || connection.model("ChatFile", createChatFileSchema());
}
