import mongoose, { Document, Schema } from 'mongoose';
import { NotificationType } from './types';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    isRead: {
      type: Boolean,
      required: true,
      default: false,
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

// Indexes
notificationSchema.index({ userId: 1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 }); // Notification dropdown
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 }); // Unread count + list

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
export default Notification;
