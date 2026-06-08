import mongoose, { Document, Schema } from 'mongoose';

export interface IComment extends Document {
  fileId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  content: string;
  mentions: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    fileId: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      required: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    mentions: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Indexes
commentSchema.index({ fileId: 1 });
commentSchema.index({ workspaceId: 1 });
commentSchema.index({ authorId: 1 });

export const Comment = mongoose.model<IComment>('Comment', commentSchema);
export default Comment;
