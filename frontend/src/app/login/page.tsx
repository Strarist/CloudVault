'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../store/authStore';
import { KeyRound, Mail, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, logout, error, loading, clearError, isAuthenticated, user, hasInitialized } =
    useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const wantsSwitch = searchParams.get('switch') === '1';

  // Clear errors and read query params on mount
  useEffect(() => {
    clearError();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('registered') === 'true') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSuccessMessage('Account created successfully! Please sign in.');
      }
    }
  }, [clearError]);

  // If ?switch=1, sign out so a different account can log in
  useEffect(() => {
    if (!wantsSwitch || !hasInitialized) return;
    let cancelled = false;
    (async () => {
      setSwitchingAccount(true);
      try {
        await logout();
        if (!cancelled) {
          router.replace('/login');
        }
      } finally {
        if (!cancelled) setSwitchingAccount(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantsSwitch, hasInitialized, logout, router]);

  // Redirect if already authenticated (unless switching)
  useEffect(() => {
    if (isAuthenticated && !wantsSwitch && !switchingAccount) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, wantsSwitch, switchingAccount, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);
    clearError();

    // Client-side validations
    if (username.trim().length < 3) {
      setValidationError('Username or email must be at least 3 characters long');
      return;
    }
    if (password.trim().length < 8) {
      setValidationError('Password must be at least 8 characters long');
      return;
    }

    try {
      await login(username, password);
      router.push('/dashboard');
    } catch {
      // Error handled by store
    }
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setSwitchingAccount(false);
    }
  };

  if (switchingAccount || (wantsSwitch && isAuthenticated)) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm text-slate-500 mt-3">Switching account...</p>
      </div>
    );
  }

  // Soft gate: already signed in — continue or switch (middleware may still bounce if cookie present)
  if (isAuthenticated && user && !wantsSwitch) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center min-h-screen relative overflow-hidden bg-slate-950 px-4 py-12">
        <div className="relative z-10 w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-2xl p-8 space-y-4 text-center">
          <h1 className="text-lg font-semibold text-slate-200">Already signed in</h1>
          <p className="text-sm text-slate-400">
            Continue as <span className="text-slate-200 font-medium">{user.name}</span>
            {user.username ? (
              <span className="text-indigo-400"> @{user.username}</span>
            ) : null}
            {' '}({user.email})
          </p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer"
          >
            Continue to dashboard
          </button>
          <button
            type="button"
            onClick={handleSwitchAccount}
            disabled={loading}
            className="w-full px-4 py-3 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-medium cursor-pointer"
          >
            Switch account (sign out)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center min-h-screen relative overflow-hidden bg-slate-950 px-4 py-12">
      {/* Glow Effects */}
      <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-violet-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block text-2xl font-bold tracking-tight text-white mb-2">
            Cloud<span className="text-indigo-400">Vault</span>
          </Link>
          <h1 className="text-xl font-semibold text-slate-200">Sign in to your account</h1>
          <p className="text-sm text-slate-400 mt-1">Access your secure workspace and files</p>
        </div>

        {/* Form Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Success Message */}
            {successMessage && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm animate-fade-in">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Error Message */}
            {(error || validationError) && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm animate-shake">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{validationError || error}</span>
              </div>
            )}

            {/* Username/Email Input */}
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-slate-300">
                Username or Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  placeholder="name@example.com or username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <KeyRound className="w-5 h-5" />
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              id="submit-login"
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 px-4 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/25 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none text-sm cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-slate-800/80"></div>
            <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              New to CloudVault?
            </span>
            <div className="flex-grow border-t border-slate-800/80"></div>
          </div>

          {/* Toggle Register */}
          <div className="text-center">
            <Link
              id="link-to-register"
              href="/register"
              className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline transition duration-150 font-medium"
            >
              Create a free account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
