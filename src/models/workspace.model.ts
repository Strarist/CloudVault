import mongoose, { Document, Schema } from 'mongoose';
import { WorkspaceType } from './types';

export interface IWorkspace extends Document {
  name: string;
  description?: string;
  ownerId: mongoose.Types.ObjectId;
  type: WorkspaceType;
  aiEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(WorkspaceType),
      required: true,
    },
    aiEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
workspaceSchema.index({ ownerId: 1 });
workspaceSchema.index({ type: 1 });
workspaceSchema.index({ deletedAt: 1 });

export const Workspace = mongoose.model<IWorkspace>('Workspace', workspaceSchema);
export default Workspace;
