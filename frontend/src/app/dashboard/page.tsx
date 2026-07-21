'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { useWorkspaceStore, FileDetails } from '../../store/workspaceStore';
import { shouldRedirectToLogin } from '../../lib/sessionGuards';
import { 
  LogOut, 
  Folder, 
  Users, 
  HardDrive, 
  Loader2, 
  Sparkles, 
  ChevronDown, 
  Plus, 
  Mail, 
  Trash2, 
  UserMinus,
  AlertTriangle,
  CheckCircle2,
  X,
  FileUp,
  File,
  Download,
  Activity,
  MessageSquare
} from 'lucide-react';
import { isValidEmailAddress } from '../../lib/validation';
import NotificationsDropdown from '../../components/NotificationsDropdown';
import CommentsDrawer from '../../components/CommentsDrawer';
import AISummaryPanel from '../../components/AISummaryPanel';

export default function DashboardPage() {
  const router = useRouter();
  
  // Auth Store
  const { user, isAuthenticated, hasInitialized, loading: authLoading, logout } = useAuthStore();
  
  // Workspace Store
  const { 
    workspaces, 
    activeWorkspace, 
    members, 
    loading: wsLoading, 
    error: wsError,
    files,
    fileLoading,
    fileUploadProgress,
    activities,
    activityPagination,
    activityLoading,
    setActiveWorkspace,
    createWorkspace,
    inviteMember,
    updateMemberRole,
    removeMember,
    clearError,
    uploadFile,
    downloadFile,
    deleteFile,
    fetchActivity,
    searchResults,
    searchLoading,
    intelligence,
    intelligenceLoading,
    searchFiles,
    clearSearch,
    toggleWorkspaceAI
  } = useWorkspaceStore();

  // Local States
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsDesc, setNewWsDesc] = useState('');
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'EDITOR' | 'VIEWER'>('VIEWER');
  
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Collaboration / Comments Drawer States
  const [selectedFile, setSelectedFile] = useState<FileDetails | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isAISummaryOpen, setIsAISummaryOpen] = useState(false);

  // Search local states
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic' | 'hybrid'>('keyword');

  // Debouncing effect
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Trigger search on debounced query change or mode change
  useEffect(() => {
    if (activeWorkspace && debouncedQuery.trim().length >= 2) {
      searchFiles(activeWorkspace.workspaceId._id, debouncedQuery, searchMode);
    } else {
      clearSearch();
    }
  }, [debouncedQuery, searchMode, activeWorkspace, searchFiles, clearSearch]);

  interface SearchDisplayFile extends FileDetails {
    matchedOn?: 'name' | 'tag' | 'summary' | 'semantic';
    score?: number;
  }

  // Reset query when switching workspaces
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchQuery('');
    setDebouncedQuery('');
    setSearchMode('keyword');
  }, [activeWorkspace]);

  // Live calculation of files to display based on search
  const isSearching = searchQuery.trim().length >= 2;
  const displayFiles: SearchDisplayFile[] = isSearching
    ? searchResults.map((result) => {
        const originalFile = files.find((f) => f._id === result.fileId);
        const fileObj = originalFile
          ? { ...originalFile }
          : ({
              _id: result.fileId,
              name: result.name,
              workspaceId: activeWorkspace?.workspaceId._id || '',
              status: 'ACTIVE',
              aiStatus: result.aiStatus,
              summary: result.summary,
              tags: result.tags,
              createdAt: result.updatedAt,
              updatedAt: result.updatedAt,
              createdBy: { _id: '', name: 'Unknown', email: '' }
            } as FileDetails);

        return {
          ...fileObj,
          matchedOn: result.matchedOn,
          score: result.score
        };
      })
    : files;

  const renderAIStatusBadge = (status: 'NOT_STARTED' | 'PROCESSING' | 'READY' | 'FAILED' | 'PENDING') => {
    const isAIEnabled = activeWorkspace?.workspaceId?.aiEnabled;
    if (!isAIEnabled) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800/40 text-slate-500 border border-slate-700/40">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
          AI Disabled
        </span>
      );
    }

    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Queued
          </span>
        );
      case 'NOT_STARTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800/40 text-slate-400 border border-slate-700/60">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            Not Started
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Loader2 className="w-3 h-3 animate-spin" />
            Analyzing...
          </span>
        );
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Insight Ready
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            {status || 'Unknown'}
          </span>
        );
    }
  };

  useEffect(() => {
    if (shouldRedirectToLogin({ hasInitialized, isAuthenticated, loading: authLoading })) {
      router.push('/login');
    }
  }, [hasInitialized, isAuthenticated, authLoading, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch {
      router.replace('/login');
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();
    
    if (newWsName.trim().length < 3) {
      setFormError('Workspace name must be at least 3 characters long');
      return;
    }

    try {
      await createWorkspace(newWsName, newWsDesc);
      setNewWsName('');
      setNewWsDesc('');
      setIsCreateModalOpen(false);
      setFormSuccess('Workspace created successfully!');
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create workspace';
      setFormError(errorMsg);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    clearError();

    if (!isValidEmailAddress(inviteEmail)) {
      setFormError('Please enter a valid email address');
      return;
    }

    try {
      await inviteMember(inviteEmail, inviteRole);
      setInviteEmail('');
      setInviteRole('VIEWER');
      setFormSuccess('Collaborator added successfully!');
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to invite collaborator';
      setFormError(errorMsg);
    }
  };

  const handleRoleChange = async (memberUserId: string, newRole: 'ADMIN' | 'EDITOR' | 'VIEWER') => {
    setFormError(null);
    clearError();
    try {
      await updateMemberRole(memberUserId, newRole);
      setFormSuccess('Member role updated successfully!');
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update member role';
      setFormError(errorMsg);
    }
  };

  const handleKickMember = async (memberUserId: string) => {
    setFormError(null);
    clearError();
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await removeMember(memberUserId);
      setFormSuccess('Member removed successfully!');
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove member';
      setFormError(errorMsg);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!activeWorkspace) return;
    setFormError(null);
    clearError();
    if (!confirm('Are you sure you want to leave this team workspace?')) return;
    try {
      await removeMember(user!._id);
      setFormSuccess('Successfully left workspace.');
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to leave workspace';
      setFormError(errorMsg);
    }
  };
  
  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setFormError(null);
    setFormSuccess(null);
    clearError();
    
    try {
      await uploadFile(file);
      setFormSuccess(`File "${file.name}" uploaded successfully!`);
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to upload file';
      setFormError(errorMsg);
    } finally {
      e.target.value = '';
    }
  };

  const handleFileDownload = async (fileId: string, fileName: string) => {
    setFormError(null);
    setFormSuccess(null);
    clearError();
    try {
      const downloadUrl = await downloadFile(fileId);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', fileName);
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to download file';
      setFormError(errorMsg);
    }
  };

  const handleFileDelete = async (fileId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete file "${fileName}"?`)) return;
    setFormError(null);
    setFormSuccess(null);
    clearError();
    try {
      await deleteFile(fileId);
      setFormSuccess(`File "${fileName}" deleted successfully.`);
      setTimeout(() => setFormSuccess(null), 3000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete file';
      setFormError(errorMsg);
    }
  };

  const handleOpenComments = (file: FileDetails) => {
    setSelectedFile(file);
    setIsCommentsOpen(true);
  };

  const handleNotificationSelect = async (workspaceId: string, fileId: string) => {
    // 1. Switch workspace if necessary
    if (!activeWorkspace || activeWorkspace.workspaceId._id !== workspaceId) {
      const targetMembership = workspaces.find((w) => w.workspaceId._id === workspaceId);
      if (targetMembership) {
        await setActiveWorkspace(targetMembership);
      } else {
        setFormError('Workspace not found or access denied');
        return;
      }
    }

    // 2. Open Comments Drawer
    let targetFile = files.find((f) => f._id === fileId);
    
    if (!targetFile) {
      // Create a skeleton file details object so that comments can still load even if files list is loading
      targetFile = {
        _id: fileId,
        name: 'Selected File',
        workspaceId,
        status: 'ACTIVE',
        aiStatus: 'NOT_STARTED',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: { _id: '', name: 'Workspace Member', email: '' }
      } as FileDetails;
    }

    setSelectedFile(targetFile || null);
    setIsCommentsOpen(true);
  };

  // Auth loading spinner
  if (!hasInitialized || authLoading || (!isAuthenticated && !user)) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center min-h-screen bg-slate-950">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/10 blur-xl rounded-full animate-pulse" />
          <Loader2 className="w-10 h-10 animate-spin text-indigo-400 relative z-10" />
        </div>
        <p className="text-sm text-slate-500 mt-4 font-medium tracking-wide">Loading workspace...</p>
      </div>
    );
  }

  if (!user) return null;

  const userRole = activeWorkspace?.role;
  const isTeamWorkspace = activeWorkspace?.workspaceId.type === 'TEAM';
  const canManageMembers = isTeamWorkspace && (userRole === 'OWNER' || userRole === 'ADMIN');
  const canWriteFiles = !!userRole && ['OWNER', 'ADMIN', 'EDITOR'].includes(userRole);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-950 text-slate-100">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-slate-900/40 backdrop-blur-md border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          
          {/* Logo & Dropdown Switcher */}
          <div className="flex items-center gap-4">
            <span className="text-xl font-bold tracking-tight text-white hidden md:inline">
              Cloud<span className="text-indigo-400">Vault</span>
            </span>

            {/* Switcher Dropdown */}
            <div className="relative">
              <button
                id="workspace-switcher"
                onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-sm font-medium text-slate-200 transition duration-150 cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="max-w-[150px] truncate">
                  {activeWorkspace ? activeWorkspace.workspaceId.name : 'Select Workspace'}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>

              {isSwitcherOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-2 z-50 animate-fade-in">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-2 py-1.5 border-b border-slate-800/60 mb-1">
                    Your Workspaces
                  </div>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {workspaces.map((ws) => (
                      <button
                        key={ws._id}
                        id={`select-workspace-${ws.workspaceId._id}`}
                        onClick={async () => {
                          await setActiveWorkspace(ws);
                          setIsSwitcherOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition duration-150 flex items-center justify-between cursor-pointer ${
                          activeWorkspace?.workspaceId._id === ws.workspaceId._id
                            ? 'bg-indigo-600 text-white font-semibold'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        <span className="truncate">{ws.workspaceId.name}</span>
                        <span className="text-[9px] uppercase tracking-wider opacity-70">
                          {ws.role}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-slate-800/80 mt-2 pt-2">
                    <button
                      id="btn-create-workspace"
                      onClick={() => {
                        setIsSwitcherOpen(false);
                        setIsCreateModalOpen(true);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/25 hover:border-indigo-500/50 text-xs text-indigo-400 font-medium transition duration-150 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Team Workspace</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Search Bar & Mode Selector */}
          <div className="flex-1 max-w-xl mx-6 hidden md:flex items-center gap-2 relative animate-fade-in">
            <div className="relative flex-1">
              <input
                id="search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files by name, tags, or summary..."
                className="w-full pl-10 pr-10 py-2 rounded-xl bg-slate-950/60 border border-slate-800 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all duration-200"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                {searchLoading ? (
                  <Loader2 className="h-4 w-4 text-indigo-400 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-slate-500" />
                )}
              </div>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            {/* Segmented Mode Selector */}
            <div className="flex items-center gap-0.5 shrink-0 bg-slate-950/50 p-1 rounded-xl border border-slate-800 text-[10px] font-semibold text-slate-400">
              <button
                type="button"
                id="search-mode-keyword"
                onClick={() => setSearchMode('keyword')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  searchMode === 'keyword'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'hover:text-slate-200'
                }`}
              >
                Keyword
              </button>
              <button
                type="button"
                id="search-mode-semantic"
                onClick={() => setSearchMode('semantic')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  searchMode === 'semantic'
                    ? 'bg-indigo-600/90 text-white shadow-sm'
                    : 'hover:text-slate-200'
                }`}
              >
                Semantic
              </button>
              <button
                type="button"
                id="search-mode-hybrid"
                onClick={() => setSearchMode('hybrid')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  searchMode === 'hybrid'
                    ? 'bg-violet-600/90 text-white shadow-sm'
                    : 'hover:text-slate-200'
                }`}
              >
                Hybrid
              </button>
            </div>
          </div>

          {/* User Widget */}
          <div className="flex items-center gap-3">
            <NotificationsDropdown
              onSelectNotification={handleNotificationSelect}
            />
            <div className="hidden sm:flex flex-col text-right leading-tight">
              <span className="text-sm font-medium text-slate-200">{user.name}</span>
              <span className="text-xs text-slate-500">
                {user.username ? `@${user.username}` : user.email}
              </span>
            </div>
            
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white text-sm shadow-md">
              {user.name.charAt(0).toUpperCase()}
            </div>

            <button
              id="btn-logout"
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-rose-950/30 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900/50 transition duration-150 text-sm font-medium cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col">
        
        {/* Error / Success Notifications */}
        {(wsError || formError || formSuccess) && (
          <div id="ws-error" className="mb-6 space-y-2">
            {(wsError || formError) && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm animate-shake">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{formError || wsError}</span>
              </div>
            )}
            {formSuccess && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm animate-fade-in">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{formSuccess}</span>
              </div>
            )}
          </div>
        )}

        {/* Active Workspace Banner */}
        {activeWorkspace ? (
          <div className="relative overflow-hidden bg-slate-900/45 border border-slate-800/80 rounded-2xl px-5 py-4 mb-6">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none" />
            
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-indigo-400 text-[10px] font-semibold uppercase tracking-wider mb-1">
                  <Sparkles className="w-3.5 h-3.5" /> Active Workspace · {activeWorkspace.workspaceId.type}
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white truncate">
                  {activeWorkspace.workspaceId.name}
                </h1>
                {activeWorkspace.workspaceId.description ? (
                  <p className="text-slate-400 text-sm max-w-xl mt-1 line-clamp-2">
                    {activeWorkspace.workspaceId.description}
                  </p>
                ) : null}
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                  Role: <span className="text-indigo-400 font-bold uppercase">{activeWorkspace.role}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <div className="flex items-center gap-3 px-3 py-2 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                  <HardDrive className="w-4 h-4 text-indigo-400" />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500">Storage Used</span>
                    <span className="text-sm font-semibold text-slate-300">0 GB / 10 GB</span>
                  </div>
                </div>

                {isTeamWorkspace && userRole !== 'OWNER' && (
                  <button
                    id="btn-leave-workspace"
                    onClick={handleLeaveWorkspace}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 rounded-xl text-sm font-medium transition duration-150 cursor-pointer"
                  >
                    <UserMinus className="w-4 h-4" />
                    <span>Leave Workspace</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-slate-900/35 border border-slate-800/60 rounded-2xl mb-8">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
            <p className="text-slate-400 text-sm">Fetching workspaces...</p>
          </div>
        )}

        {/* Workspace Operations Container */}
        {activeWorkspace && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Col: Workspace Administration / Members */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Workspace Files View */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Folder className="w-5 h-5 text-indigo-400" />
                    <span>
                      {isSearching
                        ? `Search Results (${displayFiles.length})`
                        : `Workspace Files (${files ? files.length : 0})`}
                    </span>
                  </h2>
                  
                  {canWriteFiles && (
                    <div className="relative">
                      <input
                        id="file-upload-input"
                        type="file"
                        onChange={handleFileUpload}
                        className="hidden"
                        disabled={fileLoading}
                      />
                      <button
                        id="btn-upload-file"
                        onClick={() => document.getElementById('file-upload-input')?.click()}
                        disabled={fileLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition duration-150 cursor-pointer disabled:opacity-50"
                      >
                        <FileUp className="w-4 h-4" />
                        <span>Upload File</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* File Upload Progress */}
                {fileLoading && fileUploadProgress > 0 && fileUploadProgress < 100 && (
                  <div className="mb-4 p-3 bg-slate-950/65 border border-indigo-500/20 rounded-xl animate-pulse">
                    <div className="flex justify-between text-xs text-indigo-400 font-semibold mb-1">
                      <span>Uploading file...</span>
                      <span>{fileUploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${fileUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {fileLoading && fileUploadProgress === 0 && (
                  <div className="flex items-center gap-2 py-4 justify-center text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>Processing file...</span>
                  </div>
                )}

                {/* Files List Table */}
                {isSearching && searchLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
                    <p className="text-slate-400 text-sm">Searching files...</p>
                  </div>
                ) : isSearching && displayFiles.length === 0 ? (
                  <div className="text-center py-12 bg-slate-950/20 border border-dashed border-slate-800 rounded-xl">
                    <Sparkles className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm font-medium">No results found.</p>
                    <p className="text-slate-600 text-xs mt-1">Try refining your query or check for typos.</p>
                  </div>
                ) : !fileLoading && (!files || files.length === 0) ? (
                  <div className="text-center py-12 bg-slate-950/20 border border-dashed border-slate-800 rounded-xl">
                    <Folder className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm font-medium">No files uploaded yet.</p>
                    <p className="text-slate-600 text-xs mt-1">Get started by uploading a file to this workspace.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse" id="files-list">
                      <thead>
                        <tr className="border-b border-slate-800/60 text-slate-400 text-xs font-semibold uppercase">
                          <th className="pb-3 font-medium">File Name</th>
                          <th className="pb-3 font-medium">Size</th>
                          <th className="pb-3 font-medium">Uploaded By</th>
                          <th className="pb-3 font-medium">Created At</th>
                          <th className="pb-3 font-medium">AI Insights</th>
                          <th className="pb-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-sm">
                        {displayFiles && displayFiles.map((file) => (
                          <tr key={file._id} className="group hover:bg-slate-900/10 transition">
                            <td className="py-3.5 pr-3 max-w-[200px] sm:max-w-[300px]">
                              <div className="flex items-center gap-2.5">
                                <File className="w-4 h-4 text-indigo-400 shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-semibold text-slate-200 truncate" title={file.name}>
                                    {file.name}
                                  </span>
                                  {file.matchedOn && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                        file.matchedOn === 'semantic'
                                          ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                          : searchMode === 'hybrid'
                                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                          : 'bg-slate-800 text-slate-405 border-slate-700/60'
                                      }`}>
                                        {file.matchedOn === 'semantic'
                                          ? 'Semantic Match'
                                          : searchMode === 'hybrid'
                                          ? 'Hybrid Match'
                                          : 'Keyword Match'}{' '}
                                        {(file.matchedOn === 'semantic' || searchMode === 'hybrid') && typeof file.score === 'number' && (
                                          <span className="opacity-80 ml-1">
                                            ({Math.round(file.score * 100)}%)
                                          </span>
                                        )}
                                      </span>
                                      {(file.matchedOn === 'semantic' || searchMode === 'hybrid') && typeof file.score === 'number' && file.score >= 0.7 && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                          Relevant by AI
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-3 text-slate-400 font-mono text-xs">
                              {formatSize(file.currentVersionId?.fileSize)}
                            </td>
                            <td className="py-3.5 pr-3 text-slate-400">
                              {file.createdBy?.name || 'Unknown'}
                            </td>
                            <td className="py-3.5 pr-3 text-slate-400 text-xs">
                              {new Date(file.createdAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </td>
                            <td className="py-3.5 pr-3">
                              {renderAIStatusBadge(file.aiStatus)}
                            </td>
                            <td className="py-3.5 text-right space-x-1.5">
                              <button
                                id={`ai-insights-${file._id}`}
                                onClick={() => {
                                  setSelectedFile(file);
                                  setIsAISummaryOpen(true);
                                }}
                                className={`p-1.5 rounded-lg transition duration-150 cursor-pointer inline-flex items-center justify-center ${
                                  selectedFile?._id === file._id && isAISummaryOpen
                                    ? 'text-indigo-400 bg-indigo-500/10'
                                    : 'text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10'
                                }`}
                                title="AI Insights"
                              >
                                <Sparkles className="w-4 h-4" />
                              </button>
                              <button
                                id={`download-${file._id}`}
                                onClick={() => handleFileDownload(file._id, file.name)}
                                className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition duration-150 cursor-pointer inline-flex items-center justify-center"
                                title="Download File"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                id={`comments-${file._id}`}
                                onClick={() => handleOpenComments(file)}
                                className={`p-1.5 rounded-lg transition duration-150 cursor-pointer inline-flex items-center justify-center ${
                                  selectedFile?._id === file._id && isCommentsOpen
                                    ? 'text-indigo-400 bg-indigo-500/10'
                                    : 'text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10'
                                }`}
                                title="Comments"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>
                              {canWriteFiles && (
                                <button
                                  id={`delete-${file._id}`}
                                  onClick={() => handleFileDelete(file._id, file.name)}
                                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition duration-150 cursor-pointer inline-flex items-center justify-center"
                                  title="Delete File"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Members List Box */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" />
                    <span>Workspace Members ({members.length})</span>
                  </h2>
                </div>

                {wsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse" id="members-list">
                      <thead>
                        <tr className="border-b border-slate-800/60 text-slate-400 text-xs font-semibold uppercase">
                          <th className="pb-3 font-medium">User</th>
                          <th className="pb-3 font-medium">Role</th>
                          {canManageMembers && <th className="pb-3 font-medium text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-sm">
                        {members.map((member) => (
                          <tr key={member._id} className="group">
                            <td className="py-3.5 pr-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700/60 flex items-center justify-center font-medium text-slate-200">
                                  {member.userId.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-200">{member.userId.name}</span>
                                  <span className="text-xs text-slate-500">{member.userId.email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-3">
                              {canManageMembers && member.role !== 'OWNER' && member.userId._id !== user._id ? (
                                <select
                                  id={`role-select-${member.userId._id}`}
                                  value={member.role}
                                  onChange={(e) => handleRoleChange(member.userId._id, e.target.value as 'ADMIN' | 'EDITOR' | 'VIEWER')}
                                  disabled={
                                    userRole === 'ADMIN' && member.role === 'ADMIN' // ADMIN cannot modify other ADMIN
                                  }
                                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                >
                                  {userRole === 'OWNER' && <option value="ADMIN">ADMIN</option>}
                                  {/* ADMIN can only manage EDITOR & VIEWER */}
                                  {(userRole === 'OWNER' || member.role !== 'ADMIN') && (
                                    <>
                                      <option value="EDITOR">EDITOR</option>
                                      <option value="VIEWER">VIEWER</option>
                                    </>
                                  )}
                                </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                                  member.role === 'OWNER' ? 'bg-amber-500/10 text-amber-400' :
                                  member.role === 'ADMIN' ? 'bg-indigo-500/10 text-indigo-400' :
                                  member.role === 'EDITOR' ? 'bg-emerald-500/10 text-emerald-400' :
                                  'bg-slate-500/10 text-slate-400'
                                }`}>
                                  {member.role}
                                </span>
                              )}
                            </td>
                            {canManageMembers && (
                              <td className="py-3.5 text-right">
                                {member.role !== 'OWNER' && member.userId._id !== user._id && (
                                  <button
                                    id={`kick-${member.userId._id}`}
                                    onClick={() => handleKickMember(member.userId._id)}
                                    disabled={userRole === 'ADMIN' && member.role === 'ADMIN'}
                                    className="p-1.5 text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:pointer-events-none hover:bg-rose-500/10 rounded-lg transition duration-150 cursor-pointer"
                                    title="Kick member"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>


            </div>

            {/* Right Col: Invite collaborators panel */}
            <div className="space-y-8">
              {/* Workspace Intelligence Panel */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <span>Workspace Intelligence</span>
                  </h2>
                  {intelligence && activeWorkspace && (
                    (userRole === 'OWNER' || userRole === 'ADMIN') ? (
                      <button
                        onClick={async () => {
                          try {
                            await toggleWorkspaceAI(activeWorkspace.workspaceId._id, !intelligence.aiEnabled);
                          } catch (e: any) {
                            alert(e.message || 'Failed to toggle AI settings');
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold cursor-pointer transition hover:bg-slate-800/80 border ${
                          intelligence.aiEnabled
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:border-emerald-500/40'
                            : 'bg-slate-850 text-slate-400 border-slate-700/60 hover:border-slate-600/80'
                        }`}
                        title="Click to toggle AI processing for this workspace"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${intelligence.aiEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                        {intelligence.aiEnabled ? 'AI Enabled' : 'AI Disabled'}
                      </button>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        intelligence.aiEnabled
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-slate-850 text-slate-500 border-slate-700/60'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${intelligence.aiEnabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        {intelligence.aiEnabled ? 'AI Enabled' : 'AI Disabled'}
                      </span>
                    )
                  )}
                </div>

                {intelligenceLoading && !intelligence ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                  </div>
                ) : !intelligence ? (
                  <p className="text-xs text-slate-500">Failed to load intelligence metrics.</p>
                ) : (
                  <div className="space-y-6">
                    {/* Coverage stats */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-400">AI Processing Coverage</span>
                        <span className="font-semibold text-white">{intelligence.coverage}%</span>
                      </div>
                      <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-850">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${intelligence.coverage}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 flex justify-between items-center gap-2">
                        <span className="truncate">{intelligence.processedFiles} of {intelligence.totalFiles} files analyzed</span>
                        <span className="text-indigo-400 font-semibold shrink-0">Search Ready: {intelligence.searchReady || 0}</span>
                      </p>
                    </div>

                    {/* Top Tags */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
                        Top Workspace Tags
                      </h3>
                      {intelligence.topTags.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No tags found in this workspace.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {intelligence.topTags.map((tag) => (
                            <button
                              key={tag}
                              onClick={() => setSearchQuery(tag)}
                              className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-slate-950 border border-slate-800 text-indigo-300 hover:text-white hover:border-indigo-500 transition duration-150 cursor-pointer"
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Recent Insights list */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
                        Recent AI Insights
                      </h3>
                      {intelligence.recentInsights.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No processed insights available yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {intelligence.recentInsights.map((insight) => (
                            <div
                              key={insight.fileId}
                              className="p-3 bg-slate-950/50 hover:bg-slate-950 border border-slate-800/80 rounded-xl space-y-1.5 transition duration-150 group cursor-pointer"
                              onClick={() => {
                                const matchedFile = files.find(f => f._id === insight.fileId);
                                if (matchedFile) {
                                  setSelectedFile(matchedFile);
                                  setIsAISummaryOpen(true);
                                }
                              }}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <h4 className="text-xs font-bold text-slate-200 group-hover:text-indigo-400 truncate max-w-[150px]">
                                  {insight.name}
                                </h4>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {new Date(insight.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                                {insight.summary || 'No summary available.'}
                              </p>
                              {insight.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {insight.tags.slice(0, 3).map((tag) => (
                                    <span key={tag} className="text-[9px] font-semibold text-indigo-400/85">
                                      #{tag}
                                    </span>
                                  ))}
                                  {insight.tags.length > 3 && (
                                    <span className="text-[9px] text-slate-500">
                                      +{insight.tags.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canManageMembers ? (
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                    <Mail className="w-5 h-5 text-indigo-400" />
                    <span>Invite Collaborator</span>
                  </h2>
                  <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                    Add new members to your team workspace instantly. They must already have a registered CloudVault email address.
                  </p>

                  <form onSubmit={handleInviteMember} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="invite-email" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Email Address
                      </label>
                      <input
                        id="invite-email"
                        type="email"
                        required
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm transition"
                        disabled={wsLoading}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="invite-role" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Workspace Role
                      </label>
                      <select
                        id="invite-role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'EDITOR' | 'VIEWER')}
                        className="block w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm transition"
                        disabled={wsLoading}
                      >
                        {userRole === 'OWNER' && <option value="ADMIN">ADMIN</option>}
                        <option value="EDITOR">EDITOR</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </div>

                    <button
                      id="invite-submit"
                      type="submit"
                      disabled={wsLoading}
                      className="w-full flex justify-center items-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition cursor-pointer disabled:opacity-50"
                    >
                      {wsLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <span>Invite Member</span>
                      )}
                    </button>
                  </form>
                </div>
              ) : isTeamWorkspace ? (
                <div className="bg-slate-900/10 border border-slate-800/40 rounded-2xl p-6 text-center">
                  <Users className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold text-slate-300">Invite Members</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Only workspace owners and administrators can invite new members to team drives.
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900/15 border border-slate-800/30 rounded-2xl p-6 text-center">
                  <Sparkles className="w-8 h-8 text-indigo-400/60 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold text-slate-300">Personal Workspace</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                    This workspace is isolated. Personal files are kept fully private. To collaborate, switch to or create a Team Workspace.
                  </p>
                </div>
              )}

              {/* Activity Feed Box */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-indigo-400" />
                  <span>Recent Activity</span>
                </h2>
                <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                  Real-time audit log of collaboration and file actions inside this workspace.
                </p>

                {activityLoading && activities.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                  </div>
                ) : !activities || activities.length === 0 ? (
                  <div className="text-center py-8 bg-slate-950/10 border border-dashed border-slate-800/80 rounded-xl">
                    <Activity className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-400 text-xs font-medium">No activity recorded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flow-root">
                      <ul className="-mb-8">
                        {activities.map((act, actIdx) => {
                          let description = '';
                          const actorName = act.actorId?.name || 'Someone';

                          switch (act.action) {
                            case 'WORKSPACE_CREATED':
                              description = `created workspace "${act.metadata.workspaceName || 'Unknown'}"`;
                              break;
                            case 'WORKSPACE_MEMBER_ADDED':
                              description = `added member with role ${act.metadata.role || 'VIEWER'}`;
                              break;
                            case 'WORKSPACE_MEMBER_REMOVED':
                              description = `removed member from workspace`;
                              break;
                            case 'WORKSPACE_ROLE_CHANGED':
                              description = `changed member role from ${act.metadata.oldRole} to ${act.metadata.newRole}`;
                              break;
                            case 'FILE_UPLOADED':
                              description = `uploaded file "${act.metadata.fileName || 'Unknown'}"`;
                              break;
                            case 'FILE_DELETED':
                              description = `deleted file "${act.metadata.fileName || 'Unknown'}"`;
                              break;
                            case 'FILE_DOWNLOADED':
                              description = `downloaded file "${act.metadata.fileName || 'Unknown'}"`;
                              break;
                            default:
                              description = `performed action ${act.action}`;
                          }

                          return (
                            <li key={act._id}>
                              <div className="relative pb-6">
                                {actIdx !== activities.length - 1 ? (
                                  <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-800" aria-hidden="true" />
                                ) : null}
                                <div className="relative flex space-x-3">
                                  <div>
                                    <span className="h-8 w-8 rounded-full bg-slate-850 border border-slate-700/60 flex items-center justify-center text-xs font-semibold text-indigo-400">
                                      {actorName.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                                    <div>
                                      <p className="text-xs text-slate-300">
                                        <span className="font-semibold text-slate-200">{actorName}</span>{' '}
                                        {description}
                                      </p>
                                    </div>
                                    <div className="text-right text-[9px] whitespace-nowrap text-slate-500 font-medium">
                                      {new Date(act.timestamp).toLocaleTimeString(undefined, {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {/* Pagination Controls */}
                    {activityPagination.total > activityPagination.limit && (
                      <div className="flex items-center justify-between border-t border-slate-800/80 pt-4 mt-2">
                        <button
                          onClick={() => fetchActivity(activeWorkspace!.workspaceId._id, activityPagination.page - 1)}
                          disabled={activityPagination.page <= 1 || activityLoading}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-[11px] font-semibold text-slate-400 hover:text-slate-200 border border-slate-800/85 disabled:opacity-40 transition cursor-pointer"
                        >
                          Previous
                        </button>
                        <span className="text-[10px] text-slate-500 font-medium">
                          Page {activityPagination.page} of {Math.ceil(activityPagination.total / activityPagination.limit)}
                        </span>
                        <button
                          onClick={() => fetchActivity(activeWorkspace!.workspaceId._id, activityPagination.page + 1)}
                          disabled={
                            activityPagination.page >= Math.ceil(activityPagination.total / activityPagination.limit) ||
                            activityLoading
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-[11px] font-semibold text-slate-400 hover:text-slate-200 border border-slate-800/85 disabled:opacity-40 transition cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Create Team Workspace Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-white">Create Team Workspace</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-850 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="ws-create-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Workspace Name
                </label>
                <input
                  id="ws-create-name"
                  type="text"
                  required
                  placeholder="e.g. Frontend Engineering"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="block w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm transition"
                  disabled={wsLoading}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ws-create-desc" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Description (Optional)
                </label>
                <textarea
                  id="ws-create-desc"
                  placeholder="e.g. Workspace for core frontend discussions"
                  value={newWsDesc}
                  onChange={(e) => setNewWsDesc(e.target.value)}
                  rows={3}
                  className="block w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm transition resize-none"
                  disabled={wsLoading}
                />
              </div>

              <button
                id="ws-create-submit"
                type="submit"
                disabled={wsLoading}
                className="w-full flex justify-center items-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition cursor-pointer disabled:opacity-50"
              >
                {wsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Create Workspace</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Comments Drawer */}
      <CommentsDrawer
        isOpen={isCommentsOpen}
        onClose={() => setIsCommentsOpen(false)}
        file={selectedFile}
        workspaceId={activeWorkspace?.workspaceId._id}
        members={members}
        currentUserId={user._id}
      />
      {/* AI Summary Panel */}
      <AISummaryPanel
        isOpen={isAISummaryOpen}
        onClose={() => setIsAISummaryOpen(false)}
        file={selectedFile}
        workspaceId={activeWorkspace?.workspaceId._id}
        userRole={activeWorkspace?.role}
      />
    </div>
  );
}
