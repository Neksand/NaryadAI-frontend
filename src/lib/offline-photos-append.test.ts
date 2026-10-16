// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
}));

import {
  addOfflinePhotoDraftRef,
  listOfflinePhotoDraftRefs,
  listOfflinePhotos,
  offlinePhotoKey,
  pruneStagedPhotos,
  readStagedBytes,
  readStagedFile,
  removeOfflinePhotoDraftRefs,
  saveOfflinePhoto,
} from './offline-photos';

beforeEach(() => store.clear());

describe('staged offline photo helpers', () => {
  it('reads staged bytes for a local photo id', async () => {
    const saved = await saveOfflinePhoto(
      'worker-a',
      new Blob(['staged bytes'], { type: 'image/jpeg' }),
      'after',
    );

    const bytes = await readStagedBytes('worker-a', saved.localId);

    expect(bytes).toBeInstanceOf(Blob);
    expect(await bytes?.text()).toBe('staged bytes');
    const staged = await readStagedFile('worker-a', saved.localId);
    expect(staged?.file).toBeInstanceOf(File);
    expect(staged?.file).not.toBe(saved.data);
    expect(await staged?.file.text()).toBe('staged bytes');
    await expect(readStagedBytes('worker-a', 'missing')).resolves.toBeNull();
  });

  it('persists attachment refs across a remount and removes only explicitly detached refs', async () => {
    const first = await saveOfflinePhoto('worker-a', new Blob(['first']), 'after', 'one.jpg', 'camera');
    const second = await saveOfflinePhoto('worker-a', new Blob(['second']), 'after', 'two.jpg', 'picker');
    await addOfflinePhotoDraftRef('worker-a', 'worker-order:o1', {
      localId: first.localId,
      kind: 'after',
      source: 'camera',
    });
    await addOfflinePhotoDraftRef('worker-a', 'worker-order:o1', {
      localId: second.localId,
      kind: 'after',
      source: 'picker',
    });

    // A fresh component reads the refs from persisted storage.
    await expect(listOfflinePhotoDraftRefs('worker-a', 'worker-order:o1')).resolves.toEqual([
      expect.objectContaining({ localId: first.localId, source: 'camera' }),
      expect.objectContaining({ localId: second.localId, source: 'picker' }),
    ]);
    await removeOfflinePhotoDraftRefs('worker-a', 'worker-order:o1', [first.localId]);
    await expect(listOfflinePhotoDraftRefs('worker-a', 'worker-order:o1')).resolves.toEqual([
      expect.objectContaining({ localId: second.localId }),
    ]);
  });

  it('serializes rapid saves so each staged photo is retained', async () => {
    const saved = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        saveOfflinePhoto('worker-a', new Blob([String(index)]), 'before'),
      ),
    );
    expect((await listOfflinePhotos('worker-a')).map((photo) => photo.localId)).toEqual(
      saved.map((photo) => photo.localId),
    );
  });

  it('prunes only staged photos that are not in the keep list', async () => {
    const kept = await saveOfflinePhoto('worker-a', new Blob(['keep']), 'before');
    await saveOfflinePhoto('worker-a', new Blob(['remove']), 'after');
    const alsoKept = await saveOfflinePhoto('worker-a', new Blob(['also keep']), 'after');

    await pruneStagedPhotos('worker-a', [kept.localId, alsoKept.localId]);

    expect((await listOfflinePhotos('worker-a')).map((photo) => photo.localId)).toEqual([
      kept.localId,
      alsoKept.localId,
    ]);
    expect(store.has(offlinePhotoKey('worker-a'))).toBe(true);
  });
});
