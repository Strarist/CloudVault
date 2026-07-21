import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workspace Dashboard - CloudVault',
  description: 'Manage files, version history, collaborate with teams, and use smart search in your private cloud workspaces.',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
