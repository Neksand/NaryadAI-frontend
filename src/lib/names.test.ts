import { describe, expect, it } from 'vitest';
import { dualName, pickName, pickPersonName } from './names';

describe('bilingual names', () => {
  it('picks kk name when lang is kk', () => {
    expect(pickName({ name: 'Подшипник', name_kk: 'Мойынтірек' }, 'kk')).toBe('Мойынтірек');
    expect(pickName({ name: 'Подшипник', name_kk: 'Мойынтірек' }, 'ru')).toBe('Подшипник');
  });

  it('falls back to ru when kk is missing', () => {
    expect(pickName({ name: 'Муфта' }, 'kk')).toBe('Муфта');
    expect(pickName({ name: 'Муфта', name_kk: '  ' }, 'kk')).toBe('Муфта');
  });

  it('prefers full_name for people', () => {
    expect(pickPersonName({ full_name: 'Ахметов Е.', login: 'w01' }, 'kk')).toBe('Ахметов Е.');
  });

  it('dualName shows both for admin review', () => {
    expect(dualName({ name: 'Масло И-40', name_kk: 'И-40 майы' })).toBe('Масло И-40 / И-40 майы');
    expect(dualName({ name: 'Муфта' })).toBe('Муфта');
    expect(dualName({ name_kk: 'Май' })).toBe('Май');
    expect(dualName({ name: 'Одно', name_kk: 'Одно' })).toBe('Одно');
    expect(dualName(null)).toBe('');
    expect(dualName({})).toBe('');
  });

  it('handles null items', () => {
    expect(pickName(null, 'ru')).toBe('');
    expect(pickName(undefined, 'kk')).toBe('');
    expect(pickName({ name: null }, 'ru')).toBe('');
  });

  it('pickPersonName falls back to login', () => {
    expect(pickPersonName({ login: 'worker01' }, 'ru')).toBe('worker01');
    expect(pickPersonName({ name: 'Насос', name_kk: 'Сорғы' }, 'kk')).toBe('Сорғы');
    expect(pickPersonName(null, 'ru')).toBe('');
  });
});
