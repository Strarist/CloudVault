import mongoose, { Document, Schema } from 'mongoose';
import { AIStatus } from './types';

export interface IFileVersion extends Document {
  fileId: mongoose.Types.ObjectId;
  versionNumber: number;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: mongoose.Types.ObjectId;
  aiStatus: AIStatus;
  createdAt: Date;
}

const fileVersionSchema = new Schema<IFileVersion>(
  {
    fileId: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      required: true,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    storageKey: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    aiStatus: {
      type: String,
      enum: Object.values(AIStatus),
      required: true,
      default: AIStatus.NOT_STARTED,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index: fileId + versionNumber
fileVersionSchema.index({ fileId: 1, versionNumber: 1 }, { unique: true });

export const FileVersion = mongoose.model<IFileVersion>('FileVersion', fileVersionSchema);
export default FileVersion;
