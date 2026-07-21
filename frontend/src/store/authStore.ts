import { create } from 'zustand';
import axios from 'axios';
import { apiClient, setLoggingOutFlag } from '../api/client';
import { resetAbortController } from '../api/abort-controller';
import { useWorkspaceStore } from './workspaceStore';

export interface User {
  _id: string;
  email: string;
  username?: string;
  name: string;
  avatar?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  hasInitialized: boolean;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  hasInitialized: false,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      // Clear previous account workspace state before adopting the new session
      useWorkspaceStore.getState().resetState();
      const response = await apiClient.post('/auth/login', { username, password });
      set({
        user: response.data.user,
        isAuthenticated: true,
        hasInitialized: true,
        loading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Login failed';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false, isAuthenticated: false, hasInitialized: true });
      throw new Error(errorMsg);
    }
  },

  register: async (email, username, password) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post('/auth/register', { email, username, password });
      // Registration succeeds, we can proceed to log them in or ask to login
      set({ loading: false, hasInitialized: true });
    } catch (err: unknown) {
      let errorMsg = 'Registration failed';
      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data as
          | {
              error?: string;
              message?: string;
              errors?: { msg: string }[];
            }
          | undefined;
        errorMsg =
          responseData?.error ||
          responseData?.message ||
          responseData?.errors?.[0]?.msg ||
          errorMsg;
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },

  logout: async () => {
    // Set flag to prevent retry loops on 401 during logout
    setLoggingOutFlag(true);
    // Cancel any in-flight requests
    resetAbortController();
    
    set({ loading: true, error: null });
    try {
      await apiClient.post('/auth/logout');
    } catch (err: unknown) {
      let errorMsg = 'Logout failed';
      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data as { error?: string } | undefined;
        errorMsg = responseData?.error || errorMsg;
      }
      set({
        error: errorMsg,
      });
    } finally {
      // Ensure state is cleared synchronously, even if logout request fails
      useWorkspaceStore.getState().resetState();
      set({
        user: null,
        isAuthenticated: false,
        hasInitialized: true,
        loading: false,
      });
      // Clear the logout flag after state updates are done
      setLoggingOutFlag(false);
    }
  },

  fetchMe: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get('/auth/me');
      set({
        user: response.data,
        isAuthenticated: true,
        hasInitialized: true,
        loading: false,
      });
    } catch (err: unknown) {
      // Fail silently on me lookup (implies not logged in or logout in progress)
      // If we get a 401 or abort error during logout, just clear the state quietly
      useWorkspaceStore.getState().resetState();
      set({ user: null, isAuthenticated: false, hasInitialized: true, loading: false });
    }
  },
}));
