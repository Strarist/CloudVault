import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex-1 flex flex-col justify-center items-center relative overflow-hidden bg-slate-950 px-6 py-24 text-center">
      {/* Background glow animations */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-purple-500/10 blur-[100px] rounded-full pointer-events-none" />

      <main className="relative z-10 max-w-4xl mx-auto flex flex-col items-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium text-indigo-400 mb-8 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Introducing CloudVault MVP
        </div>

        {/* Heading */}
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white mb-6">
          Collaborate securely with{' '}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
            Intelligent Storage
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg text-slate-400 max-w-2xl mb-12 leading-relaxed">
          CloudVault is an enterprise-grade collaborative storage drive featuring granular RBAC permissions, physical file versioning, contextual commenting, and natural language document intelligence.
        </p>

        {/* CTA Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Link
            id="cta-login"
            href="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/35 transition-all duration-300"
          >
            Sign In to Drive
          </Link>
          <Link
            id="cta-register"
            href="/register"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 transition-all duration-300"
          >
            Create Free Account
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 text-center text-xs text-slate-600">
        &copy; {new Date().getFullYear()} CloudVault. All rights reserved.
      </footer>
    </div>
  );
}
