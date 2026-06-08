import mongoose, { Document, Schema } from 'mongoose';
import { FileStatus, AIStatus } from './types';

export interface IFile extends Document {
  name: string;
  workspaceId: mongoose.Types.ObjectId;
  folderId?: mongoose.Types.ObjectId;
  currentVersionId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  status: FileStatus;
  summary?: string;
  tags: string[];
  aiStatus: AIStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const fileSchema = new Schema<IFile>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
    },
    currentVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'FileVersion',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(FileStatus),
      required: true,
      default: FileStatus.PENDING_UPLOAD,
    },
    summary: {
      type: String,
      default: '',
    },
    tags: {
      type: [String],
      default: [],
    },
    aiStatus: {
      type: String,
      enum: Object.values(AIStatus),
      required: true,
      default: AIStatus.NOT_STARTED,
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
fileSchema.index({ workspaceId: 1 });
fileSchema.index({ folderId: 1 });
fileSchema.index({ workspaceId: 1, folderId: 1 }); // Compound index for file browsing inside workspace/folder
fileSchema.index({ createdBy: 1 });
fileSchema.index({ status: 1 });

export const File = mongoose.model<IFile>('File', fileSchema);
export default File;
