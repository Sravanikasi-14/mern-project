import mongoose from "mongoose";

export function createConversationMemberSchema() {
  const schema = new mongoose.Schema(
    {
      conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        index: true,
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      joinedAt: {
        type: Date,
        default: Date.now,
      },
      leftAt: {
        type: Date,
        default: null,
      },
      lastReadAt: {
        type: Date,
        default: null,
      },
      lastReadMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null,
      },
      muted: {
        type: Boolean,
        default: false,
      },
    },
    {
      timestamps: true,
      collection: "conversationMembers",
    }
  );

  schema.index({ conversationId: 1, userId: 1 }, { unique: true });
  schema.index({ userId: 1, leftAt: 1, conversationId: 1 });

  return schema;
}

export function getConversationMemberModel(connection) {
  return (
    connection.models.ConversationMember ||
    connection.model("ConversationMember", createConversationMemberSchema())
  );
}
