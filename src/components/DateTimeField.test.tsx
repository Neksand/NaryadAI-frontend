// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { DateTimeField, parseDueInput } from './DateTimeField';

describe('parseDueInput', () => {
  it('parses dd.mm.yyyy, hh:mm', () => {
    const iso = parseDueInput('12.10.2026, 09:05');
    expect(iso).not.toBeNull();
    const d = new Date(iso as string);
    expect(d.getDate()).toBe(12);
    expect(d.getMonth()).toBe(9);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(5);
  });

  it('rejects garbage and impossible dates', () => {
    expect(parseDueInput('')).toBeNull();
    expect(parseDueInput('2026-10-12 09:05')).toBeNull();
    expect(parseDueInput('32.13.2026, 25:99')).toBeNull();
    expect(parseDueInput('31.02.2026, 10:00')).toBeNull();
  });
});

describe('DateTimeField interactions', () => {
  it('commits valid input and reports impossible dates without submitting them', () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeField value="" onChange={onChange} required />);
    const input = screen.getByPlaceholderText('дд.мм.гггг, чч:мм');
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: '31.02.2026, 10:00' } });
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Формат: дд.мм.гггг, чч:мм')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '29.02.2028, 10:15' } });
    const value = onChange.mock.lastCall?.[0] as string;
    expect(new Date(value).toISOString()).toBe(value);
  });

  it('uses the calendar to choose today and commits the selected local date as ISO', () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeField value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать в календаре' }));
    const dialog = screen.getByRole('dialog', { name: 'Выбрать в календаре' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сегодня' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    const value = onChange.mock.lastCall?.[0] as string;
    expect(new Date(value).getDate()).toBe(new Date().getDate());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changes month, selects a day, and accepts only digits in time fields', () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeField value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать в календаре' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Далее' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '1', exact: true }));
    const timeInputs = within(dialog).getAllByRole('textbox');
    fireEvent.change(timeInputs[0], { target: { value: '9x2' } });
    expect(timeInputs[0]).toHaveValue('92');
    fireEvent.change(timeInputs[0], { target: { value: '09' } });
    fireEvent.change(timeInputs[1], { target: { value: '4x5' } });
    expect(timeInputs[1]).toHaveValue('45');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(new Date(onChange.mock.lastCall?.[0] as string).getMinutes()).toBe(45);
  });

  it('cancels the calendar without changing the date', () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeField value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать в календаре' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers an hour preset that emits a valid future ISO timestamp', () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeField value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+1 ч' }));
    const value = onChange.mock.lastCall?.[0] as string;
    expect(new Date(value).toISOString()).toBe(value);
    expect(new Date(value).getTime()).toBeGreaterThan(Date.now());
  });
});
