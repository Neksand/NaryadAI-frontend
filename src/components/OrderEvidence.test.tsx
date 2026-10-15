// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderAssessment, OrderPhotos } from './OrderEvidence';
import { renderWithProviders } from '../test-utils';

const urlMock = vi.hoisted(() => vi.fn());
vi.mock('../api/photos', () => ({ photoUrl: urlMock }));
beforeEach(() => vi.clearAllMocks());

it('does not invent an assessment while the saved review is absent', () => {
  renderWithProviders(<OrderAssessment review={null} />);
  expect(screen.queryByText('Оценка выполнения')).toBeNull();
});

it('shows final human score, explanation, remarks and suggestions', () => {
  renderWithProviders(
    <OrderAssessment
      review={{
        verdict: 'accepted_with_remarks',
        score: 80,
        master_score: 65,
        explanation: 'Проверено по правилам',
        master_comment: 'Перепроверить крепления',
        confidence: 0.6,
        strengths: ['Работы описаны'],
        improvements: ['Добавить ракурс'],
      }}
    />,
  );
  expect(screen.getByText('65 / 100')).toBeVisible();
  expect(screen.getByText('Оценка мастера (0–100)')).toBeVisible();
  expect(screen.getByText(/Рекомендация ИИ:/)).toBeVisible();
  expect(screen.getByText('Принято с замечаниями')).toBeVisible();
  expect(screen.getByText('Проверено по правилам')).toBeVisible();
  expect(screen.getByText(/Перепроверить крепления/)).toBeVisible();
  expect(screen.getByText('Добавить ракурс')).toBeVisible();
});

it('keeps low-confidence results explicitly under human review', () => {
  renderWithProviders(
    <OrderAssessment review={{ verdict: 'needs_master_review', score: 0, confidence: null }} />,
  );
  expect(screen.getByText('Нужно решение мастера')).toBeVisible();
  expect(screen.getByText('0 / 100')).toBeVisible();
});

it('renders no photo panel when there is no evidence', () => {
  renderWithProviders(<OrderPhotos photos={undefined} />);
  expect(screen.queryByRole('region')).toBeNull();
});

it('gets private signed URLs and shows distinct before and after photos', async () => {
  urlMock.mockImplementation(async (id: string) => `http://storage.test/${id}`);
  renderWithProviders(
    <OrderPhotos
      photos={[
        { id: 'before-1', kind: 'before' },
        { id: 'after-1', kind: 'after' },
      ]}
    />,
  );
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', 'http://storage.test/before-1');
  expect(screen.getAllByRole('img')[1]).toHaveAttribute('src', 'http://storage.test/after-1');
  expect(urlMock).toHaveBeenCalledWith('before-1');
});

it('opens tapped photo in the lightbox and closes it', async () => {
  const u = userEvent.setup();
  urlMock.mockResolvedValue('http://storage.test/after-1');
  renderWithProviders(<OrderPhotos photos={[{ id: 'after-1', kind: 'after' }]} />);
  await u.click(await screen.findByRole('button', { name: 'Открыть фото' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByTestId('lightbox-image')).toHaveAttribute(
    'src',
    'http://storage.test/after-1',
  );
  await u.click(screen.getByRole('button', { name: 'Закрыть' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('allows a failed private photo URL to be retried', async () => {
  const u = userEvent.setup();
  urlMock
    .mockRejectedValueOnce(new Error('expired'))
    .mockResolvedValue('http://storage.test/after-1');
  renderWithProviders(<OrderPhotos photos={[{ id: 'after-1', kind: 'after' }]} />);
  await u.click(await screen.findByRole('button', { name: 'Повторить' }));
  await waitFor(() =>
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://storage.test/after-1'),
  );
});

it('accepts serialized JSONB review lists from the real asyncpg response', () => {
  renderWithProviders(
    <OrderAssessment
      review={{
        verdict: 'accepted',
        score: 80,
        strengths: '["Работа описана"]',
        improvements: '["Проверьте крепления"]',
      }}
    />,
  );
  expect(screen.getByText('Работа описана')).toBeVisible();
  expect(screen.getByText('Проверьте крепления')).toBeVisible();
});
