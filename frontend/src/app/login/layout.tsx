import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Sign In - CloudVault',
  description:
    'Log in to your CloudVault collaborative drive to access and manage your workspace documents securely.',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
