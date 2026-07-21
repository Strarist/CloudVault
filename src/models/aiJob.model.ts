import mongoose, { Schema, Document } from 'mongoose';

export interface IAIJob extends Document {
  workspaceId: mongoose.Types.ObjectId;
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  jobType: 'SUMMARIZE_AND_EMBED' | 'OCR' | 'CLASSIFICATION' | 'CUSTOM';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  maxAttempts: number;
  priority: number; // 0 = High (manual retry), 1 = Standard (new upload), 2+ = Low (retry backoffs)
  lastError?: {
    message: string;
    stack?: string;
    timestamp: Date;
    errorType: 'TRANSIENT' | 'PERMANENT';
  };
  runAfter: Date;
  claimedAt?: Date;
  workerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const aiJobSchema = new Schema<IAIJob>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    fileVersionId: { type: Schema.Types.ObjectId, ref: 'FileVersion', required: true },
    jobType: {
      type: String,
      enum: ['SUMMARIZE_AND_EMBED', 'OCR', 'CLASSIFICATION', 'CUSTOM'],
      default: 'SUMMARIZE_AND_EMBED',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    attemptCount: { type: Number, default: 0, required: true },
    maxAttempts: { type: Number, default: 3, required: true },
    priority: { type: Number, default: 1, required: true },
    lastError: {
      message: { type: String },
      stack: { type: String },
      timestamp: { type: Date },
      errorType: { type: String, enum: ['TRANSIENT', 'PERMANENT'] },
    },
    runAfter: { type: Date, default: Date.now, required: true },
    claimedAt: { type: Date },
    workerId: { type: String },
  },
  {
    timestamps: true,
  },
);

// Indexes
aiJobSchema.index({ status: 1, priority: 1, runAfter: 1, createdAt: 1 });
aiJobSchema.index({ fileVersionId: 1, jobType: 1 }, { unique: true });
aiJobSchema.index({ workspaceId: 1, status: 1 });

export const AIJob = mongoose.model<IAIJob>('AIJob', aiJobSchema);
export default AIJob;
