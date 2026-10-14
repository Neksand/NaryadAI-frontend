import { create } from 'zustand';
import { UserSchema, type Role, type User } from '../types/domain';
import { setTokens } from '../lib/api-client';

const CACHED_USER_KEY = 'naryadai.cached-user.v1';

function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* storage can be disabled in private or embedded browsers */
  }
}

export function readCachedUser(): User | null {
  try {
    const value = localStorage.getItem(CACHED_USER_KEY);
    if (!value) return null;
    const parsed = UserSchema.safeParse(JSON.parse(value));
    return parsed.success ? { ...parsed.data, login: parsed.data.login ?? '' } : null;
  } catch {
    return null;
  }
}

interface AuthState {
  user: User | null;
  role: Role | null;
  accessToken: string | null;
  bootstrapped: boolean;
  setSession: (user: User, access: string, refresh?: string | null) => void;
  restoreCachedSession: () => boolean;
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
    cacheUser(user);
    set({ user, role: user.role, accessToken: access });
  },
  restoreCachedSession: () => {
    const user = readCachedUser();
    if (!user) return false;
    // Cached identity only unlocks read snapshots; never persist or invent an access token.
    setTokens(null);
    set({ user, role: user.role, accessToken: null });
    return true;
  },
  setAccessToken: (access) => set({ accessToken: access }),
  setBootstrapped: () => set({ bootstrapped: true }),
  logout: () => {
    setTokens(null, null);
    cacheUser(null);
    set({ user: null, role: null, accessToken: null });
  },
}));

export function roleHome(role: Role | null): string {
  switch (role) {
    case 'worker':
      return '/worker';
    case 'master':
      return '/master';
    case 'manager':
      return '/manager';
    case 'admin':
      return '/admin';
    default:
      return '/login';
  }
}
