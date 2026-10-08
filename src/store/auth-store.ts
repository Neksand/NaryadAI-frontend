import { create } from 'zustand';
import type { Role, User } from '../types/domain';
import { setTokens } from '../lib/api-client';

interface AuthState {
  user: User | null;
  role: Role | null;
  accessToken: string | null;
  bootstrapped: boolean;
  setSession: (user: User, access: string, refresh?: string | null) => void;
  setAccessToken: (access: string | null) => void;
  setBootstrapped: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  accessToken: null,
  bootstrapped: false,
  setSession: (user, access, refresh) => {
    setTokens(access, refresh);
    set({ user, role: user.role, accessToken: access });
  },
  setAccessToken: (access) => set({ accessToken: access }),
  setBootstrapped: () => set({ bootstrapped: true }),
  logout: () => {
    setTokens(null, null);
    set({ user: null, role: null, accessToken: null });
  },
}));

export function roleHome(role: Role | null): string {
  switch (role) {
    case 'worker': return '/worker';
    case 'master': return '/master';
    case 'manager': return '/manager';
    case 'admin': return '/admin';
    default: return '/login';
  }
}
