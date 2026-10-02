import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { GuestGuard } from '@/components/guest-guard';
import { AppLayout } from '@/components/app-layout';

export function ProtectedPage({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppLayout>{children}</AppLayout>
    </AuthGuard>
  );
}

export function GuestPage({ children }: { children: ReactNode }) {
  return <GuestGuard>{children}</GuestGuard>;
}