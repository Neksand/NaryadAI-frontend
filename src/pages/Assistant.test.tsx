// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistantPage, { ASSISTANT_HISTORY_KEY } from './Assistant';
import { renderWithProviders } from '../test-utils';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api-client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/api-client')>();
  return { ...mod, api: { post: postMock } };
});
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const CITED = {
  answer_text: 'Просроченных нарядов: 2. Топ просроченных: №101; №102.',
  citations: [{ work_order_id: '11111111-1111-4111-8111-111111111111' }],
  confidence: 1.0,
};

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('ИИ-ассистент'), text);
  await user.click(screen.getByRole('button', { name: 'Спросить' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AssistantPage', () => {
  it('renders answer text with citation links to live orders', async () => {
    postMock.mockResolvedValueOnce({ data: CITED });
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);

    await ask(user, 'Какие наряды просрочены?');

    expect(postMock).toHaveBeenCalledWith('/assistant/chat', {
      question: 'Какие наряды просрочены?',
    });
    await waitFor(() => expect(screen.getByText(/Просроченных нарядов: 2/)).toBeTruthy());
    const link = screen.getByRole('link', { name: /Наряд 11111111/ });
    expect(link).toHaveAttribute('href', '/master/orders/11111111-1111-4111-8111-111111111111');
    expect(JSON.parse(localStorage.getItem(ASSISTANT_HISTORY_KEY) ?? '[]')).toHaveLength(1);
  });

  it('renders fallback answer without links', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        answer_text: 'Не понял вопрос. Спросите про сроки, смену, рейтинг или аномалии.',
        citations: [],
        confidence: 0.0,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);

    await ask(user, 'бла бла');

    await waitFor(() => expect(screen.getByText(/Не понял вопрос/)).toBeTruthy());
    expect(screen.queryByRole('link', { name: /Наряд/ })).toBeNull();
  });

  it('keeps two Q&A pairs in history', async () => {
    postMock.mockResolvedValueOnce({ data: CITED }).mockResolvedValueOnce({
      data: {
        answer_text: 'Смена: выдано 3, закрыто 1, просрочено 2.',
        citations: [],
        confidence: 1.0,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);

    await ask(user, 'Какие наряды просрочены?');
    await waitFor(() => expect(screen.getByText(/Просроченных нарядов: 2/)).toBeTruthy());
    await ask(user, 'Что по смене?');
    await waitFor(() => expect(screen.getByText(/Смена: выдано 3/)).toBeTruthy());

    expect(screen.getByText('Какие наряды просрочены?')).toBeTruthy();
    expect(screen.getByText('Что по смене?')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('shows localized error and retries on failure', async () => {
    postMock.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'boom' } } });
    postMock.mockResolvedValueOnce({ data: CITED });
    const user = userEvent.setup();
    renderWithProviders(<AssistantPage />);

    await ask(user, 'Какие наряды просрочены?');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText(/Просроченных нарядов: 2/)).toBeTruthy());
    expect(postMock).toHaveBeenCalledTimes(2);
  });
});
