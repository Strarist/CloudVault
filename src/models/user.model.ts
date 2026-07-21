import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email: string;
  username: string;
  passwordHash: string;
  name: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      minlength: [13, 'Email must be at least 13 characters long'],
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      minlength: [3, 'Username must be at least 3 characters long'],
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [3, 'Name must be at least 3 characters long'],
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  },
);

// Add unique indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

export const User = mongoose.model<IUser>('User', userSchema);
export default User;
