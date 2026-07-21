'use client';

import React, { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shouldBootstrapAuth } from '../../lib/sessionGuards';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const fetchMe = useAuthStore((state) => state.fetchMe);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasInitialized = useAuthStore((state) => state.hasInitialized);
  const loading = useAuthStore((state) => state.loading);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);

  useEffect(() => {
    if (shouldBootstrapAuth({ hasInitialized, isAuthenticated, loading })) {
      fetchMe();
    }
  }, [fetchMe, hasInitialized, isAuthenticated, loading]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchWorkspaces();
    }
  }, [isAuthenticated, fetchWorkspaces]);

  return <>{children}</>;
}

export default AuthProvider;
