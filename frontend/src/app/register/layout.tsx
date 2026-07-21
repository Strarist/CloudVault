import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register - CloudVault',
  description: 'Create a new CloudVault account to start collaborating with colleagues and manage files using secure, smart versioned storage.',
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
