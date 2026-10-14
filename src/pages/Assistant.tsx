import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, toLocalizedError } from '../lib/api-client';
import { Shell } from '../components/Shell';
import { ErrorState } from '../components/ui';

export interface AssistantCitation {
  work_order_id: string;
}

export interface AssistantAnswer {
  answer_text: string;
  citations: AssistantCitation[];
  confidence: number;
}

export interface AssistantTurn {
  question: string;
  answer: AssistantAnswer;
}

export const ASSISTANT_HISTORY_KEY = 'naryadai.assistant-history.v1';

function loadHistory(): AssistantTurn[] {
  try {
    const raw = localStorage.getItem(ASSISTANT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AssistantTurn[]) : [];
  } catch {
    return [];
  }
}

/** POST /assistant/chat {question} → {answer_text, citations, confidence}. */
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  const { data } = await api.post('/assistant/chat', { question });
  return data as AssistantAnswer;
}

/**
 * Панель ИИ-ассистента (master/manager/admin — guard вешает ProtectedRoute
 * координатора поверх этого компонента, роут в App.tsx тоже за ним).
 */
export default function AssistantPage() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<AssistantTurn[]>(loadHistory);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pushTurn = (turn: AssistantTurn) => {
    setHistory((prev) => {
      const next = [...prev, turn];
      try {
        localStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* приватный режим — история живёт только в памяти */
      }
      return next;
    });
  };

  const send = async () => {
    const q = question.trim();
    if (!q || pending) return;
    setPending(true);
    setError(null);
    try {
      const answer = await askAssistant(q);
      pushTurn({ question: q, answer });
      setQuestion('');
    } catch (err) {
      setError(toLocalizedError(err).message);
    } finally {
      setPending(false);
    }
  };

  const clear = () => {
    setHistory([]);
    try {
      localStorage.removeItem(ASSISTANT_HISTORY_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <Shell title={t('assistant.title')}>
      <form
        className="card flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {t('assistant.title')}
          <textarea
            className="input"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('assistant.placeholder')}
            aria-label={t('assistant.title')}
          />
        </label>
        <div className="flex gap-2 flex-wrap">
          <button type="submit" className="btn btn-primary" disabled={!question.trim() || pending}>
            {pending ? t('assistant.sending') : t('assistant.send')}
          </button>
          {history.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={clear}>
              {t('assistant.clear')}
            </button>
          )}
        </div>
      </form>
      {error && <ErrorState message={error} onRetry={() => void send()} />}
      {history.length === 0 ? (
        <div className="card text-[var(--ink-muted)]" role="status">
          {t('assistant.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-live="polite">
          {history.map((turn, i) => (
            <article key={`${i}-${turn.question}`} className="card flex flex-col gap-2">
              <div className="font-semibold">{turn.question}</div>
              <p className="text-[15px]">{turn.answer.answer_text}</p>
              {turn.answer.citations.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {turn.answer.citations.map((c) => (
                    <Link
                      key={c.work_order_id}
                      className="btn btn-sm"
                      to={`/master/orders/${c.work_order_id}`}
                    >
                      {t('assistant.citationLabel')} {c.work_order_id.slice(0, 8)}
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}
