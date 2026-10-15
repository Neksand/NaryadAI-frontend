// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VersionConflictNotice from './VersionConflictNotice';
import '../i18n/config';

describe('VersionConflictNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current version and lets the user refresh', async () => {
    const onRefresh = vi.fn();
    render(<VersionConflictNotice currentVersion={7} onRefresh={onRefresh} />);

    expect(screen.getByText('Данные изменились (версия 7). Обновите и повторите.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Обновить и повторить' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
