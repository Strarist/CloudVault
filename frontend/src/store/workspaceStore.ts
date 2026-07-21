import { create } from 'zustand';
import axios from 'axios';
import { apiClient } from '../api/client';

export interface WorkspaceDetails {
  _id: string;
  name: string;
  description: string;
  ownerId: string;
  type: 'PERSONAL' | 'TEAM';
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberInfo {
  _id: string;
  workspaceId: WorkspaceDetails;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

export interface MemberUser {
  _id: string;
  name: string;
  email: string;
  username: string;
  avatar?: string;
}

export interface MemberInfo {
  _id: string;
  workspaceId: string;
  userId: MemberUser;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

export interface FileVersionDetails {
  _id: string;
  fileId: string;
  versionNumber: number;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
}

export interface FileDetails {
  _id: string;
  name: string;
  workspaceId: string;
  folderId?: string;
  currentVersionId?: FileVersionDetails;
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  status: 'PENDING_UPLOAD' | 'ACTIVE' | 'UPLOAD_FAILED' | 'DELETED';
  aiStatus: 'NOT_STARTED' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  summary?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityActor {
  _id: string;
  name: string;
  email: string;
}

export interface ActivityDetails {
  _id: string;
  workspaceId: string;
  actorId: ActivityActor;
  action: 'WORKSPACE_CREATED' | 'WORKSPACE_MEMBER_ADDED' | 'WORKSPACE_MEMBER_REMOVED' | 'WORKSPACE_ROLE_CHANGED' | 'FILE_UPLOADED' | 'FILE_DELETED' | 'FILE_DOWNLOADED';
  targetId?: string;
  targetType?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  createdAt: string;
}

export interface SearchResult {
  fileId: string;
  name: string;
  mimeType: string;
  aiStatus: 'NOT_STARTED' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  summary?: string;
  tags: string[];
  updatedAt: string;
  matchedOn?: 'name' | 'tag' | 'summary' | 'semantic';
  score: number;
}

export interface RecentInsight {
  fileId: string;
  name: string;
  summary: string;
  tags: string[];
  updatedAt: string;
}

export interface WorkspaceIntelligence {
  totalFiles: number;
  processedFiles: number;
  coverage: number;
  topTags: string[];
  recentInsights: RecentInsight[];
  aiEnabled: boolean;
  searchReady: number;
}

interface WorkspaceState {
  workspaces: WorkspaceMemberInfo[];
  activeWorkspace: WorkspaceMemberInfo | null;
  members: MemberInfo[];
  files: FileDetails[];
  loading: boolean;
  fileLoading: boolean;
  fileUploadProgress: number;
  error: string | null;
  resetState: () => void;
  
  clearError: () => void;
  fetchWorkspaces: () => Promise<WorkspaceMemberInfo[]>;
  setActiveWorkspace: (membership: WorkspaceMemberInfo) => Promise<void>;
  createWorkspace: (name: string, description?: string) => Promise<void>;
  fetchMembers: (workspaceId: string) => Promise<void>;
  inviteMember: (email: string, role: 'ADMIN' | 'EDITOR' | 'VIEWER') => Promise<void>;
  updateMemberRole: (userId: string, role: 'ADMIN' | 'EDITOR' | 'VIEWER') => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  fetchFiles: (workspaceId: string) => Promise<void>;
  uploadFile: (file: File, folderId?: string) => Promise<void>;
  downloadFile: (fileId: string) => Promise<string>;
  deleteFile: (fileId: string) => Promise<void>;
  
  activities: ActivityDetails[];
  activityPagination: {
    page: number;
    limit: number;
    total: number;
  };
  activityLoading: boolean;
  fetchActivity: (workspaceId: string, page?: number, limit?: number) => Promise<void>;

  searchResults: SearchResult[];
  searchLoading: boolean;
  intelligence: WorkspaceIntelligence | null;
  intelligenceLoading: boolean;
  searchFiles: (
    workspaceId: string,
    query: string,
    mode?: 'keyword' | 'semantic' | 'hybrid',
    page?: number,
    limit?: number
  ) => Promise<void>;
  fetchIntelligence: (workspaceId: string) => Promise<void>;
  clearSearch: () => void;
  toggleWorkspaceAI: (workspaceId: string, aiEnabled: boolean) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  members: [],
  files: [],
  loading: false,
  fileLoading: false,
  fileUploadProgress: 0,
  error: null,
  activities: [],
  activityPagination: { page: 1, limit: 10, total: 0 },
  activityLoading: false,
  searchResults: [],
  searchLoading: false,
  intelligence: null,
  intelligenceLoading: false,

  resetState: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cloudvault_active_workspace_id');
    }

    set({
      workspaces: [],
      activeWorkspace: null,
      members: [],
      files: [],
      loading: false,
      fileLoading: false,
      fileUploadProgress: 0,
      error: null,
      activities: [],
      activityPagination: { page: 1, limit: 10, total: 0 },
      activityLoading: false,
      searchResults: [],
      searchLoading: false,
      intelligence: null,
      intelligenceLoading: false,
    });
  },

  clearError: () => set({ error: null }),

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get('/workspaces');
      const data = response.data as WorkspaceMemberInfo[];
      
      let nextActive = get().activeWorkspace;
      
      // If there's no active workspace, or the active workspace is no longer in the list,
      // select the first workspace in the list (usually the auto-created Personal workspace)
      if (data.length > 0) {
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('cloudvault_active_workspace_id') : null;
        const savedWorkspace = savedId ? data.find(w => w.workspaceId._id === savedId) : null;
        
        if (savedWorkspace) {
          nextActive = savedWorkspace;
        } else {
          // If stored ID is invalid or not in list, fallback to first workspace and persist it
          nextActive = data[0];
          if (typeof window !== 'undefined') {
            localStorage.setItem('cloudvault_active_workspace_id', nextActive.workspaceId._id);
          }
        }
      } else {
        nextActive = null;
        if (typeof window !== 'undefined') {
          localStorage.removeItem('cloudvault_active_workspace_id');
        }
      }

      set({
        workspaces: data,
        activeWorkspace: nextActive,
        loading: false,
      });

      if (nextActive) {
        await get().fetchMembers(nextActive.workspaceId._id);
        await get().fetchFiles(nextActive.workspaceId._id);
        await get().fetchActivity(nextActive.workspaceId._id);
        await get().fetchIntelligence(nextActive.workspaceId._id);
      }

      return data;
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch workspaces';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false });
      return [];
    }
  },

  setActiveWorkspace: async (membership) => {
    set({ activeWorkspace: membership, error: null, searchResults: [] });
    if (typeof window !== 'undefined') {
      localStorage.setItem('cloudvault_active_workspace_id', membership.workspaceId._id);
    }
    await get().fetchMembers(membership.workspaceId._id);
    await get().fetchFiles(membership.workspaceId._id);
    await get().fetchActivity(membership.workspaceId._id);
    await get().fetchIntelligence(membership.workspaceId._id);
  },

  createWorkspace: async (name, description = '') => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.post('/workspaces', { name, description });
      const { workspace, member } = response.data;
      
      const newMembership: WorkspaceMemberInfo = {
        ...member,
        workspaceId: workspace,
      };

      const updatedWorkspaces = [...get().workspaces, newMembership];
      set({
        workspaces: updatedWorkspaces,
        activeWorkspace: newMembership,
        loading: false,
      });

      if (typeof window !== 'undefined') {
        localStorage.setItem('cloudvault_active_workspace_id', workspace._id);
      }

      await get().fetchMembers(workspace._id);
      await get().fetchFiles(workspace._id);
      await get().fetchActivity(workspace._id);
    } catch (err: unknown) {
      let errorMsg = 'Failed to create workspace';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },

  fetchMembers: async (workspaceId) => {
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}`);
      const { members, role } = response.data;
      
      // Update local role weight if it changed
      const active = get().activeWorkspace;
      if (active && active.workspaceId._id === workspaceId && active.role !== role) {
        set({
          activeWorkspace: {
            ...active,
            role,
          },
        });
      }

      set({ members });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch members';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg });
    }
  },

  inviteMember: async (email, role) => {
    const active = get().activeWorkspace;
    if (!active) {
      const errorMsg = 'No active workspace selected';
      set({ error: errorMsg });
      throw new Error(errorMsg);
    }
    const normalizedEmail = email.trim().toLowerCase();
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/workspaces/${active.workspaceId._id}/members`, {
        email: normalizedEmail,
        role,
      });
      set({ loading: false });
      await get().fetchMembers(active.workspaceId._id);
      await get().fetchActivity(active.workspaceId._id);
    } catch (err: unknown) {
      let errorMsg = 'Failed to invite member';
      if (axios.isAxiosError(err)) {
        const apiError = err.response?.data?.error || err.response?.data?.message;
        if (
          err.response?.status === 404 &&
          typeof apiError === 'string' &&
          /not found/i.test(apiError)
        ) {
          errorMsg =
            'That email is not registered yet. They must create a CloudVault account first.';
        } else {
          errorMsg = apiError || errorMsg;
        }
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },

  updateMemberRole: async (userId, role) => {
    const active = get().activeWorkspace;
    if (!active) return;
    set({ loading: true, error: null });
    try {
      await apiClient.patch(`/workspaces/${active.workspaceId._id}/members/${userId}`, { role });
      set({ loading: false });
      await get().fetchMembers(active.workspaceId._id);
      await get().fetchActivity(active.workspaceId._id);
    } catch (err: unknown) {
      let errorMsg = 'Failed to update member role';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },

  removeMember: async (userId) => {
    const active = get().activeWorkspace;
    if (!active) return;
    set({ loading: true, error: null });
    try {
      await apiClient.delete(`/workspaces/${active.workspaceId._id}/members/${userId}`);
      set({ loading: false });
      
      // If we left the workspace ourselves, refetch workspaces to switch to another
      await get().fetchWorkspaces();
    } catch (err: unknown) {
      let errorMsg = 'Failed to remove member';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },

  fetchFiles: async (workspaceId) => {
    set({ fileLoading: true, error: null });
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/files`);
      set({ files: response.data.items as FileDetails[], fileLoading: false });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch files';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, fileLoading: false });
    }
  },

  uploadFile: async (file, folderId) => {
    const active = get().activeWorkspace;
    if (!active) return;
    set({ fileLoading: true, fileUploadProgress: 0, error: null });

    const formData = new FormData();
    formData.append('file', file);
    if (folderId) {
      formData.append('folderId', folderId);
    }

    try {
      await apiClient.post(`/workspaces/${active.workspaceId._id}/files/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || file.size;
          const progress = Math.round((progressEvent.loaded * 100) / total);
          set({ fileUploadProgress: progress });
        },
      });
      set({ fileLoading: false, fileUploadProgress: 100 });
      await get().fetchFiles(active.workspaceId._id);
      await get().fetchActivity(active.workspaceId._id);
      await get().fetchIntelligence(active.workspaceId._id);
    } catch (err: unknown) {
      let errorMsg = 'Failed to upload file';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, fileLoading: false, fileUploadProgress: 0 });
      throw new Error(errorMsg);
    }
  },

  downloadFile: async (fileId) => {
    const active = get().activeWorkspace;
    if (!active) throw new Error('No active workspace selected');
    set({ fileLoading: true, error: null });

    try {
      const response = await apiClient.get(`/workspaces/${active.workspaceId._id}/files/${fileId}/download`);
      set({ fileLoading: false });
      const data = response.data as {
        downloadUrl?: string;
        useApiStream?: boolean;
        streamPath?: string;
      };

      if (data.useApiStream && data.streamPath) {
        const blobResponse = await apiClient.get(data.streamPath, { responseType: 'blob' });
        return URL.createObjectURL(blobResponse.data as Blob);
      }

      if (!data.downloadUrl) {
        throw new Error('Download URL missing from server response');
      }
      return data.downloadUrl;
    } catch (err: unknown) {
      let errorMsg = 'Failed to generate download URL';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, fileLoading: false });
      throw new Error(errorMsg);
    }
  },

  deleteFile: async (fileId) => {
    const active = get().activeWorkspace;
    if (!active) {
      const errorMsg = 'No active workspace selected';
      set({ error: errorMsg });
      throw new Error(errorMsg);
    }
    set({ fileLoading: true, error: null });

    try {
      await apiClient.delete(`/workspaces/${active.workspaceId._id}/files/${fileId}`);
    } catch (err: unknown) {
      let errorMsg = 'Failed to delete file';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, fileLoading: false });
      throw new Error(errorMsg);
    }

    set({ fileLoading: false });

    const workspaceId = active.workspaceId._id;
    try {
      await get().fetchFiles(workspaceId);
    } catch {
      // Delete succeeded; file list refresh failure should not fail the operation
    }
    try {
      await get().fetchActivity(workspaceId);
    } catch {
      // Non-fatal refresh
    }
    try {
      await get().fetchIntelligence(workspaceId);
    } catch {
      // Non-fatal refresh
    }
  },

  fetchActivity: async (workspaceId, page = 1, limit = 10) => {
    set({ activityLoading: true, error: null });
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/activity`, {
        params: { page, limit },
      });
      const { items, page: rPage, limit: rLimit, total } = response.data;
      set({
        activities: items as ActivityDetails[],
        activityPagination: { page: rPage, limit: rLimit, total },
        activityLoading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch activity';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, activityLoading: false });
    }
  },

  searchFiles: async (workspaceId, query, mode = 'keyword', page = 1, limit = 20) => {
    set({ searchLoading: true, error: null });
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/search`, {
        params: { q: query, mode, page, limit },
      });
      if (response.data && response.data.available === false) {
        set({
          searchResults: [],
          searchLoading: false,
          error: response.data.reason || 'AI search is disabled for this workspace',
        });
        return;
      }
      set({
        searchResults: response.data.items as SearchResult[],
        searchLoading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to search files';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, searchLoading: false });
    }
  },

  fetchIntelligence: async (workspaceId) => {
    set({ intelligenceLoading: true, error: null });
    try {
      const response = await apiClient.get(`/workspaces/${workspaceId}/intelligence`);
      set({
        intelligence: response.data as WorkspaceIntelligence,
        intelligenceLoading: false,
      });
    } catch (err: unknown) {
      let errorMsg = 'Failed to fetch intelligence';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, intelligenceLoading: false });
    }
  },

  clearSearch: () => {
    set({ searchResults: [], searchLoading: false });
  },

  toggleWorkspaceAI: async (workspaceId, aiEnabled) => {
    set({ loading: true, error: null });
    try {
      await apiClient.post(`/workspaces/${workspaceId}/ai/toggle`, { aiEnabled });
      
      // Update activeWorkspace state inside store
      const active = get().activeWorkspace;
      if (active && active.workspaceId._id === workspaceId) {
        const updatedActive = {
          ...active,
          workspaceId: {
            ...active.workspaceId,
            aiEnabled
          }
        };
        set({ activeWorkspace: updatedActive });
      }

      // Update workspaces list
      const updatedWorkspaces = get().workspaces.map(w => {
        if (w.workspaceId._id === workspaceId) {
          return {
            ...w,
            workspaceId: {
              ...w.workspaceId,
              aiEnabled
            }
          };
        }
        return w;
      });

      set({ workspaces: updatedWorkspaces, loading: false });

      // Refresh intelligence metrics to match new toggle state
      await get().fetchIntelligence(workspaceId);
    } catch (err: unknown) {
      let errorMsg = 'Failed to toggle AI settings';
      if (axios.isAxiosError(err)) {
        errorMsg = err.response?.data?.error || err.response?.data?.message || errorMsg;
      }
      set({ error: errorMsg, loading: false });
      throw new Error(errorMsg);
    }
  },
}));
