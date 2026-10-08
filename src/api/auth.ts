import { api } from '../lib/api-client';
import { UserSchema, type User } from '../types/domain';

export async function login(loginName: string, pin: string): Promise<{ user: User; access: string; refresh: string | null }> {
  const { data } = await api.post('/auth/login', { login: loginName, pin });
  const access: string = data.access_token ?? data.accessToken;
  const refresh: string | null = data.refresh_token ?? data.refreshToken ?? null;
  const rawUser = data.user ?? (await api.get('/me').then((r) => r.data));
  const parsed = UserSchema.parse(rawUser);
  const user: User = { ...parsed, login: parsed.login ?? '' };
  return { user, access, refresh };
}

export async function fetchMe(): Promise<User> {
  // FastAPI exposes both /me and /auth/me; try canonical /me first.
  const parse = (data: unknown): User => {
    const parsed = UserSchema.parse(data);
    return { ...parsed, login: parsed.login ?? '' };
  };
  try {
    const { data } = await api.get('/me');
    return parse(data);
  } catch {
    const { data } = await api.get('/auth/me');
    return parse(data?.user ?? data);
  }
}

export async function logout(refresh?: string | null): Promise<void> {
  try {
    await api.post('/auth/logout', refresh ? { refresh_token: refresh } : {});
  } finally {
    // store cleared by caller
  }
}

export async function registerDevice(platform: string, fcmToken: string): Promise<void> {
  await api.post('/devices', { platform, fcm_token: fcmToken });
}
