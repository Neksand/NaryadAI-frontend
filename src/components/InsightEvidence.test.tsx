// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '../i18n/config';
import { InsightEvidence, parseInsightDrilldown } from './OrderEvidence';
import { renderWithProviders } from '../test-utils';
import ru from '../i18n/ru';
import kk from '../i18n/kk';

const REPEAT = {
  id: 'ins-1',
  headline: 'Конвейер К-3: повторные отказы по шифру М-02 (12 за 30 дней)',
  order_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
  evidence: [{ metric: 'repeat_count', value: 12, baseline: 2 }],
};

describe('parseInsightDrilldown', () => {
  it('parses top-level order_ids with count/denominator/formula from evidence', () => {
    const drill = parseInsightDrilldown(REPEAT);
    expect(drill.orderIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(drill.count).toBe(12);
    expect(drill.denominator).toBe(2);
    expect(drill.formula).toContain('n / total');
    expect(drill.metric).toBe('repeat_count');
  });

  it('collects singular evidence order_id (post_ppr_case as stored by the backend)', () => {
    const drill = parseInsightDrilldown({
      id: 'ins-2',
      evidence: [
        {
          metric: 'post_ppr_case',
          order_id: 'db0f9c7b-2b0f-4221-8337-672135b34490',
        },
      ],
    });
    expect(drill.orderIds).toEqual(['db0f9c7b-2b0f-4221-8337-672135b34490']);
    expect(drill.count).toBe(1);
    expect(drill.formula).toContain('14d');
  });

  it('accepts serialized JSONB evidence strings from asyncpg', () => {
    const drill = parseInsightDrilldown({
      id: 'ins-3',
      evidence: '[{"metric":"growth","value":16,"baseline":4}]',
    });
    expect(drill.count).toBe(16);
    expect(drill.denominator).toBe(4);
    expect(drill.orderIds).toEqual([]);
  });
});

describe('InsightEvidence', () => {
  it('renders count, denominator, monospace formula and clickable order links (ru)', async () => {
    await i18n.changeLanguage('ru');
    renderWithProviders(<InsightEvidence insight={REPEAT} />);
    expect(screen.getByText(/Количество/)).toBeTruthy();
    expect(screen.getByText(/Знаменатель/)).toBeTruthy();
    const code = document.querySelector('code.font-mono');
    expect(code?.textContent).toContain('n / total');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/master/orders/11111111-1111-4111-8111-111111111111');
    expect(screen.getByText(/Корреляция не доказывает причину/)).toBeVisible();
  });

  it('shows the non-causality note in Kazakh', async () => {
    await i18n.changeLanguage('kk');
    renderWithProviders(<InsightEvidence insight={REPEAT} />);
    expect(screen.getByText(/Корреляция себепті дәлелдемейді/)).toBeVisible();
    expect(screen.getByText(/Саны/)).toBeTruthy();
    await i18n.changeLanguage('ru');
  });

  it('keeps ru/kk keys for the drill-down in parity', () => {
    const keys = [
      'analytics.evidence',
      'analytics.insightCount',
      'analytics.insightDenominator',
      'analytics.insightFormula',
      'analytics.insightOrders',
      'analytics.insightNoOrders',
      'analytics.insightNoCause',
    ] as const;
    const flat = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v))
          Object.assign(out, flat(v as Record<string, unknown>, key));
        else out[key] = v;
      }
      return out;
    };
    const flatRu = flat(ru as unknown as Record<string, unknown>);
    const flatKk = flat(kk as unknown as Record<string, unknown>);
    for (const key of keys) {
      expect(typeof flatRu[key], key).toBe('string');
      expect((flatRu[key] as string).length, key).toBeGreaterThan(0);
      expect(typeof flatKk[key], key).toBe('string');
      expect((flatKk[key] as string).length, key).toBeGreaterThan(0);
    }
  });
});
