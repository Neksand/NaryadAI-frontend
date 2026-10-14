import { Navigate } from 'react-router-dom';
import type { JSX } from 'react';
import { useAuthStore, roleHome } from '../store/auth-store';
import type { Role } from '../types/domain';
import { BootScreen } from './Boot';

export function ProtectedRoute({ allow, children }: { allow: Role[]; children: JSX.Element }) {
  const { user, role, bootstrapped } = useAuthStore();
  // Пока сессия восстанавливается (refresh+/me) — boot-экран, а не редирект на /login.
  if (!bootstrapped) return <BootScreen />;
  if (!user || !role) return <Navigate to="/login" replace />;
  if (!allow.includes(role)) return <Navigate to={roleHome(role)} replace />;
  return children;
}
