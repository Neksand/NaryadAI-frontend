// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Lightbox, type LightboxItem } from './Lightbox';

const items: LightboxItem[] = [
  { src: 'a.jpg', alt: 'first' },
  { src: 'b.jpg', alt: 'second' },
];

function renderOpen(start = 0) {
  const onIndex = vi.fn();
  const onClose = vi.fn();
  const state = { index: start };
  const rerender = render(
    <Lightbox
      items={items}
      index={state.index}
      onClose={onClose}
      onIndex={(i) => {
        onIndex(i);
        state.index = i;
      }}
    />,
  );
  return { onIndex, onClose, rerender };
}

describe('Lightbox', () => {
  it('opens at the given photo with counter', () => {
    renderOpen(1);
    expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', 'b.jpg');
    expect(screen.getByTestId('lightbox-count')).toHaveTextContent('2 / 2');
  });

  it('closes on backdrop, button and Escape', () => {
    const onClose = vi.fn();
    const noop = () => {};
    const first = render(<Lightbox items={items} index={0} onClose={onClose} onIndex={noop} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<Lightbox items={items} index={0} onClose={onClose} onIndex={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('navigates with arrows and wraps around', () => {
    const { onIndex } = renderOpen(1);
    fireEvent.click(screen.getByRole('button', { name: '›' }));
    expect(onIndex).toHaveBeenCalledWith(0);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  it('zooms with buttons and double click', () => {
    renderOpen();
    const img = screen.getByTestId('lightbox-image');
    expect(img.style.transform).toBe('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByTestId('lightbox-image').style.transform).toBe('scale(2)');
    fireEvent.doubleClick(screen.getByTestId('lightbox-image'));
    expect(screen.getByTestId('lightbox-image').style.transform).toBe('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(screen.getByTestId('lightbox-image').style.transform).toBe('scale(1)');
  });

  it('resets zoom when photo changes', () => {
    const { rerender } = renderOpen();
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByTestId('lightbox-image').style.transform).toBe('scale(1.5)');
    rerender.rerender(<Lightbox items={items} index={1} onClose={() => {}} onIndex={() => {}} />);
    expect(screen.getByTestId('lightbox-image').style.transform).toBe('scale(1)');
  });

  it('renders nothing without items', () => {
    const { container } = render(
      <Lightbox items={[]} index={0} onClose={() => {}} onIndex={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
