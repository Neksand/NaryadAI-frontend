// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18n from '../i18n/config';
import ru from '../i18n/ru';
import kk from '../i18n/kk';
import { renderWithProviders } from '../test-utils';
import { EconomicsWhatIf, type EconomicsBase } from './EconomicsWhatIf';
import {
  calcMaterialsCost,
  loadWhatIfPrices,
  parseMaterialRows,
  parsePriceInput,
  saveWhatIfPrices,
  whatIfPricesKey,
} from './PriceTable';

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

const PRICE_KEYS = [
  'whatifPriceTable',
  'whatifPriceName',
  'whatifPriceQty',
  'whatifPricePerUnit',
  'whatifPriceSum',
  'whatifPriceReset',
  'whatifPriceInvalid',
  'whatifPriceExcluded',
  'whatifPriceBadge',
  'whatifPriceAssumption',
] as const;

describe('PriceTable helpers', () => {
  it('parsePriceInput: empty/valid/invalid', () => {
    expect(parsePriceInput('')).toEqual({ status: 'empty' });
    expect(parsePriceInput('   ')).toEqual({ status: 'empty' });
    expect(parsePriceInput('5000')).toEqual({ status: 'ok', value: 5000 });
    expect(parsePriceInput('1 000,5')).toEqual({ status: 'ok', value: 1000.5 });
    expect(parsePriceInput('0')).toEqual({ status: 'ok', value: 0 });
    expect(parsePriceInput('-5').status).toBe('invalid');
    expect(parsePriceInput('abc').status).toBe('invalid');
    expect(parsePriceInput('12abc').status).toBe('invalid');
    expect(parsePriceInput('Infinity').status).toBe('invalid');
  });

  it('parseMaterialRows reads qty variants and envelopes', () => {
    expect(
      parseMaterialRows({
        items: [{ id: 'a', material_name: 'Гайка', quantity: 3, unit: 'шт' }],
      }),
    ).toEqual([{ id: 'a', name: 'Гайка', qty: 3, unit: 'шт' }]);
    expect(parseMaterialRows([{ name: 'X' }])).toEqual([
      { id: '0', name: 'X', qty: null, unit: undefined },
    ]);
    expect(parseMaterialRows({})).toEqual([]);
    expect(parseMaterialRows(null)).toEqual([]);
  });

  it('calcMaterialsCost sums qty*price, skips priceless', () => {
    const rows = [
      { id: 'a', name: 'A', qty: 2 },
      { id: 'b', name: 'B', qty: 5 },
      { id: 'c', name: 'C', qty: null },
    ];
    expect(calcMaterialsCost(rows, {})).toEqual({
      total: null,
      pricedCount: 0,
      unpricedCount: 3,
    });
    expect(calcMaterialsCost(rows, { a: 100 })).toEqual({
      total: 200,
      pricedCount: 1,
      unpricedCount: 2,
    });
    // цена без кол-ва в сумму не попадает
    expect(calcMaterialsCost(rows, { a: 100, c: 1000 })).toEqual({
      total: 200,
      pricedCount: 1,
      unpricedCount: 2,
    });
  });

  it('storage isolates users and drops garbage', () => {
    localStorage.clear();
    saveWhatIfPrices('u1', { a: 10 });
    expect(loadWhatIfPrices('u1')).toEqual({ a: 10 });
    expect(loadWhatIfPrices('u2')).toEqual({});
    expect(whatIfPricesKey('u1')).toBe('naryadai.whatif-prices:u1');
    localStorage.setItem('naryadai.whatif-prices:u2', '{broken');
    expect(loadWhatIfPrices('u2')).toEqual({});
    localStorage.setItem('naryadai.whatif-prices:u2', JSON.stringify({ a: -5, b: 'x', c: 7 }));
    expect(loadWhatIfPrices('u2')).toEqual({ c: 7 });
  });
});

describe('EconomicsWhatIf price showcase', () => {
  const MAT_ROWS = [
    { id: 'm1', name: 'Масло', qty: 10, unit: 'л' },
    { id: 'm2', name: 'Фильтр', qty: 4, unit: 'шт' },
  ];
  // Простои известны, а цен в API нет → итоги unknown, пока мастер не введёт цены.
  const NO_MATERIALS_BASE: EconomicsBase = {
    monthlyDowntimeHours: 100,
    downtimeCostPerHour: null,
    monthlyMaterialsCost: null,
  };

  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('ru');
  });

  function renderPrices(userId: string) {
    return renderWithProviders(
      <EconomicsWhatIf base={NO_MATERIALS_BASE} materials={MAT_ROWS} userId={userId} />,
    );
  }

  function setPrice(id: string, value: string) {
    fireEvent.change(screen.getByTestId(`price-input-${id}`), { target: { value } });
  }

  function inputValue(id: string): string {
    return (screen.getByTestId(`price-input-${id}`) as HTMLInputElement).value;
  }

  it('unknown base becomes computable after entering prices, in expected direction', () => {
    renderPrices('master-1');
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    expect(screen.queryByTestId('price-table')).toBeTruthy();

    // Норма +50%: рост цен на материалы давит NPV вниз.
    fireEvent.change(screen.getByTestId('whatif-norm'), { target: { value: '50' } });
    setPrice('m1', '5000');
    setPrice('m2', '2000');
    // 10×5000 + 4×2000 = 58000 → итоги считаются и подписаны «по вашим ценам».
    expect(numOf('price-sum-m1')).toBe(50000);
    expect(numOf('price-sum-m2')).toBe(8000);
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);
    expect(screen.getAllByTestId('whatif-your-prices')).toHaveLength(4);
    expect(screen.getByText(/Σ \(кол-во × ваша цена\)/)).toBeTruthy();
    const npv1 = numOf('whatif-npv');

    setPrice('m1', '10000'); // материалы подорожали → NPV вниз
    expect(numOf('whatif-npv')).toBeLessThan(npv1);
  });

  it('empty price excludes material with a mark', () => {
    renderPrices('master-2');
    setPrice('m1', '5000');
    expect(screen.getByTestId('price-sum-m2').textContent).toBe('—');
    expect(screen.getByText('без цены — не учтён')).toBeTruthy();
    expect(numOf('price-sum-m1')).toBe(50000);
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);
  });

  it('rejects negative and non-numeric prices', () => {
    renderPrices('master-3');
    setPrice('m1', '-5');
    expect(screen.getByText('Только неотрицательные числа')).toBeTruthy();
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    expect(localStorage.getItem('naryadai.whatif-prices:master-3')).toBe('{}');

    setPrice('m1', 'abc');
    expect(screen.getByText('Только неотрицательные числа')).toBeTruthy();
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);

    setPrice('m1', '0'); // ноль — неотрицательное, принимается
    expect(screen.queryByText('Только неотрицательные числа')).toBeNull();
    setPrice('m1', '5000');
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);
  });

  it('reset clears prices', () => {
    renderPrices('master-4');
    setPrice('m1', '5000');
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);

    fireEvent.click(screen.getByTestId('price-reset'));
    expect(inputValue('m1')).toBe('');
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    expect(localStorage.getItem('naryadai.whatif-prices:master-4')).toBeNull();
  });

  it('persists across unmount/remount for the same user', () => {
    const first = renderPrices('master-5');
    setPrice('m1', '5000');
    setPrice('m2', '2000');
    const npv1 = numOf('whatif-npv');
    first.unmount();

    renderPrices('master-5');
    expect(inputValue('m1')).toBe('5000');
    expect(inputValue('m2')).toBe('2000');
    expect(numOf('whatif-npv')).toBe(npv1);
  });

  it('isolates prices between users', () => {
    const first = renderPrices('master-6');
    setPrice('m1', '5000');
    first.unmount();

    const second = renderPrices('master-7');
    expect(inputValue('m1')).toBe('');
    expect(screen.getByTestId('whatif-npv').textContent).toMatch(/неизвестно/);
    second.unmount();

    renderPrices('master-6');
    expect(inputValue('m1')).toBe('5000');
    expect(screen.getByTestId('whatif-npv').textContent).not.toMatch(/неизвестно/);
  });

  it('has ru/kk parity for new price keys and renders kk badge', async () => {
    const eco = (lng: Record<string, unknown>) =>
      (lng as { economics: Record<string, unknown> }).economics;
    for (const k of PRICE_KEYS) {
      expect(typeof eco(ru as unknown as Record<string, unknown>)[k], `ru ${k}`).toBe('string');
      expect(
        (eco(ru as unknown as Record<string, unknown>)[k] as string).length,
        `ru ${k}`,
      ).toBeGreaterThan(0);
      expect(typeof eco(kk as unknown as Record<string, unknown>)[k], `kk ${k}`).toBe('string');
      expect(
        (eco(kk as unknown as Record<string, unknown>)[k] as string).length,
        `kk ${k}`,
      ).toBeGreaterThan(0);
    }

    await i18n.changeLanguage('kk');
    renderPrices('master-8');
    setPrice('m1', '5000');
    expect(screen.getAllByTestId('whatif-your-prices').length).toBe(4);
    expect(screen.getByText(/бағасыз — есепке алынбаған/)).toBeTruthy();
    await i18n.changeLanguage('ru');
  });
});
