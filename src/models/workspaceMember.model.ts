import mongoose, { Document, Schema } from 'mongoose';
import { WorkspaceRole } from './types';

export interface IWorkspaceMember extends Document {
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: WorkspaceRole;
  joinedAt: Date;
}

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(WorkspaceRole),
      required: true,
    },
    joinedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index: workspaceId + userId
workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMemberSchema.index({ userId: 1 });

export const WorkspaceMember = mongoose.model<IWorkspaceMember>(
  'WorkspaceMember',
  workspaceMemberSchema,
);
export default WorkspaceMember;
