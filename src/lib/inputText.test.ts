import { describe, expect, it } from 'vitest';
import { normalizeOrderText, trimEdges } from './inputText';

describe('inputText', () => {
  it('trims only edges, keeps inner spaces', () => {
    expect(trimEdges('  Течь масла  ')).toBe('Течь масла');
    expect(trimEdges('Гул  подшипника')).toBe('Гул  подшипника');
    expect(trimEdges('')).toBe('');
  });

  it('normalizes order fields before idempotency key', () => {
    const out = normalizeOrderText({ description: '  Течь  ', comment: ' ок ', priority: 'high' });
    expect(out).toMatchObject({ description: 'Течь', comment: 'ок', priority: 'high' });
  });

  it('normalizes nested complete form', () => {
    const out = normalizeOrderText({ form: { work_done_text: '  Заменил  ', materials: [] } });
    expect((out.form as { work_done_text: string }).work_done_text).toBe('Заменил');
  });

  it('strips unicode whitespace incl. nbsp', () => {
    expect(trimEdges(' Течь ')).toBe('Течь');
    expect(trimEdges('Течь')).toBe('Течь');
    expect(trimEdges('\t\n Гул \r\n')).toBe('Гул');
    expect(trimEdges('  Манометр  ')).toBe('Манометр');
  });

  it('leaves unknown keys and non-strings alone', () => {
    const out = normalizeOrderText({
      description: '  x  ',
      priority: 'high',
      norm_minutes: 60,
      flag: true,
    });
    expect(out).toEqual({ description: 'x', priority: 'high', norm_minutes: 60, flag: true });
  });

  it('supports custom key lists', () => {
    const out = normalizeOrderText({ title: '  t  ', description: '  d  ' }, ['title']);
    expect(out).toEqual({ title: 't', description: '  d  ' });
  });

  it('normalizes nested comment too', () => {
    const out = normalizeOrderText({ form: { work_done_text: ' w ', comment: ' c ' } });
    expect(out.form).toMatchObject({ work_done_text: 'w', comment: 'c' });
  });
});
