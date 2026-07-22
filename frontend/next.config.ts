import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Silence multi-lockfile workspace-root warning when running from frontend/
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
