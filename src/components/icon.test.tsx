// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, ICON_NAMES } from './Icon';

describe('Icon', () => {
  it('renders svg.ic with size and aria-hidden', () => {
    const { container } = render(<Icon name="bell" size={22} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('22');
    expect(svg?.getAttribute('height')).toBe('22');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.classList.contains('ic')).toBe(true);
  });

  it('supports custom className', () => {
    const { container } = render(<Icon name="check" className="big" />);
    expect(container.querySelector('svg')?.classList.contains('big')).toBe(true);
  });

  it('renders every registered icon without crashing', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.innerHTML.length, name).toBeGreaterThan(0);
      unmount();
    }
  });
});
