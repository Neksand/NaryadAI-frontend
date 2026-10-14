import { describe, expect, it } from 'vitest';
import ru from './ru';
import kk from './kk';

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe('i18n parity ru/kk', () => {
  const flatRu = flatten(ru as unknown as Record<string, unknown>);
  const flatKk = flatten(kk as unknown as Record<string, unknown>);

  it('has identical key sets', () => {
    const ruKeys = Object.keys(flatRu).sort();
    const kkKeys = Object.keys(flatKk).sort();
    const missingInKk = ruKeys.filter((k) => !(k in flatKk));
    const missingInRu = kkKeys.filter((k) => !(k in flatRu));
    expect({ missingInKk, missingInRu }).toEqual({ missingInKk: [], missingInRu: [] });
  });

  it('has no empty translations', () => {
    for (const [k, v] of Object.entries({ ...flatRu, ...flatKk })) {
      if (typeof v === 'string') expect(v.length, k).toBeGreaterThan(0);
    }
  });

  it('has no emoji in UI strings', () => {
    for (const [k, v] of Object.entries({ ...flatRu, ...flatKk })) {
      if (typeof v === 'string') expect(v, k).not.toMatch(EMOJI);
    }
  });

  it('keeps role/status/action coverage', () => {
    for (const key of ['role.worker', 'role.master', 'role.manager', 'role.admin']) {
      expect(flatRu[key]).toBeTruthy();
      expect(flatKk[key]).toBeTruthy();
    }
    for (const s of ['issued', 'in_progress', 'done', 'closed']) {
      expect(flatRu[`status.${s}`]).toBeTruthy();
    }
  });
});
