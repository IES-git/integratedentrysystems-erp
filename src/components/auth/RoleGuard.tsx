import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types';

interface RoleGuardProps {
  roles: UserRole[];
  children: ReactNode;
  redirectTo?: string;
}

/**
 * Renders children only if the authenticated user's role is in the allowed list.
 * Redirects to /app (dashboard) otherwise — the dashboard is role-aware and shows
 * appropriate content, so it's the safe fallback for unauthorized access attempts.
 */
export function RoleGuard({ roles, children, redirectTo = '/app' }: RoleGuardProps) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
