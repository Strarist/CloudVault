import mongoose, { Document, Schema } from 'mongoose';

export interface IFolder extends Document {
  name: string;
  workspaceId: mongoose.Types.ObjectId;
  parentFolderId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const folderSchema = new Schema<IFolder>(
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
    parentFolderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
folderSchema.index({ workspaceId: 1 });
folderSchema.index({ parentFolderId: 1 });

export const Folder = mongoose.model<IFolder>('Folder', folderSchema);
export default Folder;
