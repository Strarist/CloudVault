'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../store/authStore';
import { KeyRound, Mail, User, AlertTriangle, Loader2 } from 'lucide-react';
import { isValidEmailAddress } from '../../lib/validation';

export default function RegisterPage() {
  const router = useRouter();
  const { register, error, loading, clearError, isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Clear errors on mount
  useEffect(() => {
    clearError();
  }, [clearError]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearError();

    // Client-side validations (align with backend schema)
    if (!isValidEmailAddress(email)) {
      setValidationError('Please enter a valid email address');
      return;
    }
    if (username.trim().length < 3) {
      setValidationError('Username/Name must be at least 3 characters long');
      return;
    }
    if (password.trim().length < 8) {
      setValidationError('Password must be at least 8 characters long');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setValidationError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(password)) {
      setValidationError('Password must contain at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setValidationError('Password must contain at least one number');
      return;
    }

    try {
      await register(email, username, password);
      // Success! Redirect to login page with query param to trigger success banner
      router.push('/login?registered=true');
    } catch {
      // Error handled by store
    }
  };

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
          <h1 className="text-xl font-semibold text-slate-200">Create your free account</h1>
          <p className="text-sm text-slate-400 mt-1">Get started with secure collaborative cloud storage</p>
        </div>

        {/* Form Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error Message */}
            {(error || validationError) && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm animate-shake">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{validationError || error}</span>
              </div>
            )}

            {/* Email Input */}
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Username/Name Input */}
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-slate-300">
                Username or Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-5 h-5" />
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  placeholder="john_doe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200 text-sm"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
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
              id="submit-register"
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 px-4 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/25 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none text-sm cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Register Account</span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-slate-800/80"></div>
            <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              Already have an account?
            </span>
            <div className="flex-grow border-t border-slate-800/80"></div>
          </div>

          {/* Toggle Login */}
          <div className="text-center">
            <Link
              id="link-to-login"
              href="/login"
              className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline transition duration-150 font-medium"
            >
              Sign in to your account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
