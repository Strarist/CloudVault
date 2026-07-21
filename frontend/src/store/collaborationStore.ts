import { create } from 'zustand';
import axios from 'axios';
import { apiClient } from '../api/client';

export interface CommentAuthor {
  _id: string;
  username: string;
  email: string;
  avatar?: string;
}

export interface CommentDetails {
  _id: string;
  fileId: string;
  workspaceId: string;
  authorId: CommentAuthor;
  content: string;
  mentions: CommentAuthor[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDetails {
  _id: string;
  userId: string;
  type: 'COMMENT' | 'MENTION' | 'INVITATION' | 'ROLE_CHANGED';
  payload: {
    commentId?: string;
    fileId?: string;
    workspaceId?: string;
    actorId?: string;
    actorUsername?: string;
    actorName?: string;
    inviterId?: string;
    oldRole?: string;
    newRole?: string;
  };
  isRead: boolean;
  createdAt: string;
}

interface CollaborationState {
  comments: CommentDetails[];
  commentsLoading: boolean;
  commentsPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };

  notifications: NotificationDetails[];
  unreadCount: number;
  notificationsLoading: boolean;
  notificationsPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };

  error: string | null;
  clearError: () => void;
  resetState: () => void;

  fetchComments: (workspaceId: string, fileId: string, page?: number, limit?: number) => Promise<void>;
  addComment: (workspaceId: string, fileId: string, content: string) => Promise<CommentDetails>;
  deleteComment: (workspaceId: string, fileId: string, commentId: string) => Promise<void>;

  fetchNotifications: (page?: number, limit?: number) => Promise<void>;
  fetchUnreadCount: () => Promise<number>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  comments: [],
  commentsLoading: false,
  commentsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  notifications: [],
  unreadCount: 0,
  notificationsLoading: false,
  notificationsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },

  error: null,

  clearError: () => set({ error: null }),

  resetState: () => set({
    comments: [],
    commentsLoading: false,
    commentsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    notifications: [],
    unreadCount: 0,
    notificationsLoading: false,
    notificationsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    error: null,
  }),

  fetchComments: async (workspaceId, fileId, page = 1, limit = 20) => {
    set({ commentsLoading: true, error: null });
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/files/${fileId}/comments`, {
        params: { page, limit },
      });
      const { comments, pagination } = response.data;
      set({
        comments,
        commentsPagination: pagination,
        commentsLoading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch comments';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, commentsLoading: false });
    }
  },

  addComment: async (workspaceId, fileId, content) => {
    set({ commentsLoading: true, error: null });
    try {
      const response = await apiClient.post(`/workspaces/${workspaceId}/files/${fileId}/comments`, {
        content,
      });
      const newComment = response.data as CommentDetails;
      
      // Update comments list in store state by prepending the new comment
      set((state) => ({
        comments: [newComment, ...state.comments],
        commentsLoading: false,
      }));
      
      return newComment;
    } catch (err: unknown) {
      let errorMsg = 'Failed to post comment';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, commentsLoading: false });
      throw new Error(errorMsg);
    }
  },

  deleteComment: async (workspaceId, fileId, commentId) => {
    set({ commentsLoading: true, error: null });
    try {
      await apiClient.delete(`/workspaces/${workspaceId}/files/${fileId}/comments/${commentId}`);
      
      // Filter out the deleted comment from state
      set((state) => ({
        comments: state.comments.filter((c) => c._id !== commentId),
        commentsLoading: false,
      }));
    } catch (err: unknown) {
      let errorMsg = 'Failed to delete comment';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, commentsLoading: false });
      throw new Error(errorMsg);
    }
  },

  fetchNotifications: async (page = 1, limit = 20) => {
    set({ notificationsLoading: true, error: null });
    try {
      const response = await apiClient.get('/notifications', {
        params: { page, limit },
      });
      const { notifications, unreadCount, pagination } = response.data;
      set({
        notifications,
        unreadCount,
        notificationsPagination: pagination,
        notificationsLoading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch notifications';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, notificationsLoading: false });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const response = await apiClient.get('/notifications/unread-count');
      const { unreadCount } = response.data;
      set({ unreadCount });
      return unreadCount as number;
    } catch (err) {
      return 0;
    }
  },

  markAsRead: async (notificationId) => {
    try {
      await apiClient.patch(`/notifications/${notificationId}/read`);
      
      // Update specific notification's isRead in local state and decrement unread count
      set((state) => {
        const notifications = state.notifications.map((n) =>
          n._id === notificationId ? { ...n, isRead: true } : n
        );
        const oldNotif = state.notifications.find((n) => n._id === notificationId);
        const unreadCount = oldNotif && !oldNotif.isRead ? Math.max(0, state.unreadCount - 1) : state.unreadCount;
        return { notifications, unreadCount };
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to mark notification as read';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg });
    }
  },

  markAllAsRead: async () => {
    try {
      await apiClient.patch('/notifications/read-all');
      
      // Mark all notifications as read and set unreadCount to 0
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch (err: unknown) {
      let errorMsg = 'Failed to mark all notifications as read';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg });
    }
  },
}));
