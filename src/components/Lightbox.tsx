import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface LightboxItem {
  src: string;
  alt: string;
}

/** Полноэкранный просмотр фото «как на крутых сайтах»: зум кнопками и
 *  двойным тапом, листание свайпом/стрелками, закрытие по фону/крестику/Esc. */
export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const touchX = useRef<number | null>(null);

  const clamped = items.length ? (index + items.length) % items.length : 0;
  const go = useCallback(
    (d: number) => {
      if (!items.length) return;
      setZoom(1);
      onIndex((clamped + d + items.length) % items.length);
    },
    [clamped, items.length, onIndex],
  );

  useEffect(() => {
    setZoom(1);
  }, [clamped]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!items.length) return null;
  const item = items[clamped];
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('lightbox.title', 'Просмотр фото')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="lightbox-bar">
        <span className="lightbox-count" data-testid="lightbox-count">
          {clamped + 1} / {items.length}
        </span>
        <span className="lightbox-zoom" role="group" aria-label={t('lightbox.zoom', 'Масштаб')}>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="−"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="+"
            onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}
          >
            +
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom(1)}>
            {t('lightbox.reset', 'Сброс')}
          </button>
        </span>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={t('common.close', 'Закрыть')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="lightbox-stage">
        {items.length > 1 && (
          <button type="button" className="btn lightbox-nav" aria-label="‹" onClick={() => go(-1)}>
            ‹
          </button>
        )}
        <img
          src={item.src}
          alt={item.alt}
          data-testid="lightbox-image"
          className="lightbox-img"
          style={{ transform: `scale(${zoom})` }}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        />
        {items.length > 1 && (
          <button type="button" className="btn lightbox-nav" aria-label="›" onClick={() => go(1)}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
