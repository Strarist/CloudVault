import mongoose, { Schema, Document } from 'mongoose';

export interface IAIResult extends Document {
  workspaceId: mongoose.Types.ObjectId;
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  schemaVersion: number; // For schema evolution (default = 1)
  summary: string;
  tags: string[];
  extractedTextStorageKey?: string;
  extractedTextCache?: string; // Inline cached raw text, max 50KB, UTF-8 safe
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: number;
  modelProvider: string;
  modelName: string;
  modelVersion: string;
  generatedAt: Date;
}

const aiResultSchema = new Schema<IAIResult>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    fileVersionId: { type: Schema.Types.ObjectId, ref: 'FileVersion', required: true },
    schemaVersion: { type: Number, default: 1, required: true },
    summary: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    extractedTextStorageKey: { type: String },
    extractedTextCache: { type: String },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: true },
    embeddingDimensions: { type: Number, required: true },
    embeddingVersion: { type: Number, required: true },
    modelProvider: { type: String, required: true },
    modelName: { type: String, required: true },
    modelVersion: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now, required: true },
  },
  {
    timestamps: { createdAt: 'generatedAt', updatedAt: false },
  },
);

// Indexes
aiResultSchema.index({ fileVersionId: 1 }, { unique: true });
aiResultSchema.index({ fileId: 1 });
aiResultSchema.index({ workspaceId: 1 });

export const AIResult = mongoose.model<IAIResult>('AIResult', aiResultSchema);
export default AIResult;
