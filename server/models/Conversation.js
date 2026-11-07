import mongoose from "mongoose";

export const CONVERSATION_TYPES = Object.freeze({
  DIRECT: "DIRECT",
  GROUP: "GROUP",
});

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 500;

export function createConversationSchema() {
  const conversationSchema = new mongoose.Schema(
    {
      type: {
        type: String,
        enum: Object.values(CONVERSATION_TYPES),
        required: true,
        default: CONVERSATION_TYPES.DIRECT,
      },
      directKey: {
        type: String,
        trim: true,
        default: null,
      },
      lastMessageAt: {
        type: Date,
        default: null,
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: {
        type: String,
        trim: true,
        maxlength: GROUP_NAME_MAX,
        default: "",
      },
      description: {
        type: String,
        trim: true,
        maxlength: GROUP_DESCRIPTION_MAX,
        default: "",
      },
      imageStorageKey: {
        type: String,
        trim: true,
        default: null,
      },
      imageMimeType: {
        type: String,
        trim: true,
        default: null,
      },
      // Bytes stay in the tenant database so the image still loads on serverless hosts.
      imageData: {
        type: Buffer,
        default: undefined,
      },
      adminUserIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        default: [],
      },
    },
    {
      timestamps: true,
      collection: "conversations",
    }
  );

  conversationSchema.index(
    { directKey: 1 },
    {
      unique: true,
      partialFilterExpression: { type: CONVERSATION_TYPES.DIRECT, directKey: { $type: "string" } },
    }
  );
  conversationSchema.index({ lastMessageAt: -1 });

  return conversationSchema;
}

export function getConversationModel(connection) {
  return (
    connection.models.Conversation ||
    connection.model("Conversation", createConversationSchema())
  );
}

export function directKeyFor(userIdA, userIdB) {
  const pair = [String(userIdA), String(userIdB)].sort();
  return `${pair[0]}:${pair[1]}`;
}
