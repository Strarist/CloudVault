import mongoose, { Document, Schema } from 'mongoose';
import { ActivityAction } from './types';

export interface IActivityLog extends Document {
  workspaceId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  action: ActivityAction;
  targetId?: mongoose.Types.ObjectId;
  targetType?: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: Object.values(ActivityAction),
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    targetType: {
      type: String,
      default: '',
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
activityLogSchema.index({ workspaceId: 1 });
activityLogSchema.index({ actorId: 1 });
activityLogSchema.index({ timestamp: 1 });

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', activityLogSchema);
export default ActivityLog;
