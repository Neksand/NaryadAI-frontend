// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18n from '../i18n/config';
import ru from '../i18n/ru';
import kk from '../i18n/kk';
import { renderWithProviders } from '../test-utils';
import { EconomicsWhatIf, type EconomicsBase } from './EconomicsWhatIf';

const FULL_BASE: EconomicsBase = {
  monthlyDowntimeHours: 100,
  downtimeCostPerHour: null, // бэкенд цену не отдаёт — цена идёт со слайдера
  monthlyMaterialsCost: 1000000,
};

const UNKNOWN_BASE: EconomicsBase = {
  monthlyDowntimeHours: null,
  downtimeCostPerHour: null,
  monthlyMaterialsCost: null,
};

function numOf(testId: string): number {
  const text = screen.getByTestId(testId).textContent ?? '';
  return Number(text.replace(/[^\d-]/g, ''));
}

describe('EconomicsWhatIf', () => {
  it('renders sliders and computed NPV/ROI', () => {
    renderWithProviders(<EconomicsWhatIf base={FULL_BASE} />);
    expect(screen.getByTestId('whatif-price')).toBeTruthy();
    expect(screen.getByTestId('whatif-norm')).toBeTruthy();
    expect(screen.getByTestId('whatif-horizon')).toBeTruthy();
    // benefit = 100ч * 50000₸ * 20% = 1 000 000 ₸/мес
    expect(numOf('whatif-benefit')).toBe(1000000);
    expect(numOf('whatif-npv')).toBeGreaterThan(0);
  });

  it('price slider moves NPV up, materials norm moves NPV down, horizon moves NPV up', () => {
    renderWithProviders(<EconomicsWhatIf base={FULL_BASE} />);
    const npv0 = numOf('whatif-npv');

    fireEvent.change(screen.getByTestId('whatif-price'), { target: { value: '100000' } });
    const npvUp = numOf('whatif-npv');
    expect(npvUp).toBeGreaterThan(npv0);

    fireEvent.change(screen.getByTestId('whatif-norm'), { target: { value: '50' } });
    const npvDown = numOf('whatif-npv');
    expect(npvDown).toBeLessThan(npvUp);

    fireEvent.change(screen.getByTestId('whatif-horizon'), { target: { value: '24' } });
    expect(numOf('whatif-npv')).toBeGreaterThan(npvDown);
  });

  it('keeps unknown as unknown when base data is missing, even after slider moves', () => {
    renderWithProviders(<EconomicsWhatIf base={UNKNOWN_BASE} />);
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    expect(screen.getByTestId('whatif-roi').textContent).toMatch(/неизвестно/);

    fireEvent.change(screen.getByTestId('whatif-price'), { target: { value: '200000' } });
    fireEvent.change(screen.getByTestId('whatif-norm'), { target: { value: '-50' } });
    fireEvent.change(screen.getByTestId('whatif-horizon'), { target: { value: '36' } });
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    expect(screen.getByTestId('whatif-roi').textContent).toMatch(/неизвестно/);
  });

  it('switches ru/kk labels', async () => {
    renderWithProviders(<EconomicsWhatIf base={FULL_BASE} />);
    expect(screen.getByText('Что если: экономика')).toBeTruthy();

    await i18n.changeLanguage('kk');
    expect(screen.getByText('Егер … болса: экономика')).toBeTruthy();
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);

    await i18n.changeLanguage('ru');
    expect(screen.getByText('Что если: экономика')).toBeTruthy();
  });

  it('has economics.whatif* parity between ru and kk', () => {
    const flat = (o: Record<string, unknown>, p = ''): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v))
          Object.assign(out, flat(v as Record<string, unknown>, key));
        else out[key] = v;
      }
      return out;
    };
    const flatRu = flat(ru as unknown as Record<string, unknown>);
    const flatKk = flat(kk as unknown as Record<string, unknown>);
    const whatifKeys = Object.keys(flatRu).filter((k) => k.startsWith('economics.whatif'));
    expect(whatifKeys.length).toBeGreaterThan(5);
    for (const k of whatifKeys) {
      expect(typeof flatKk[k], k).toBe('string');
      expect((flatKk[k] as string).length, k).toBeGreaterThan(0);
    }
  });
});
