import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return { ...actual, api: apiMock };
});

import { deletePhoto } from './photos';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deletePhoto', () => {
  it('calls DELETE /photos/{id}', async () => {
    apiMock.delete.mockResolvedValueOnce({ data: {} });
    await deletePhoto('p123');
    expect(apiMock.delete).toHaveBeenCalledWith('/photos/p123');
    expect(apiMock.delete).toHaveBeenCalledTimes(1);
  });
});
