/** Оригинальные иконки НарядAI: единый контурный стиль, 24×24, currentColor. */
import type { ReactNode } from 'react';

export type IconName =
  | 'orders'
  | 'history'
  | 'shift'
  | 'board'
  | 'analytics'
  | 'admin'
  | 'bell'
  | 'back'
  | 'arrowRight'
  | 'logout'
  | 'refresh'
  | 'chevD'
  | 'chevU'
  | 'chevL'
  | 'chevR'
  | 'camera'
  | 'calendar'
  | 'mic'
  | 'stop'
  | 'check'
  | 'checkAll'
  | 'clock'
  | 'spark'
  | 'close';

const PATHS: Record<IconName, ReactNode> = {
  orders: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M9.5 13.5l2 2 3.5-4" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-5.2" />
    </>
  ),
  shift: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4.5V3h6v1.5" />
      <circle cx="12" cy="14" r="3.6" />
      <path d="M12 12.2v2l1.4 1" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M9.2 5v14M14.8 5v14" />
      <circle cx="6.4" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 4v15.5h16" />
      <path d="M8.5 15.5v-4" />
      <path d="M12.5 15.5v-7" />
      <path d="M16.5 15.5v-2.5" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.7 5.7l1.8 1.8M16.5 16.5l1.8 1.8M18.3 5.7l-1.8 1.8M7.5 16.5l-1.8 1.8" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16v-4.7a5.5 5.5 0 0 1 11 0V16l1.3 2.3H5.2z" />
      <path d="M10 20.5a2.1 2.1 0 0 0 4 0" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  logout: (
    <>
      <path d="M13.5 3.5H20V20h-6.5" />
      <path d="M3.5 12H14" />
      <path d="M11 8.5L14.5 12 11 15.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9.3" />
      <path d="M20 4.5v4.8h-4.8" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 14.7" />
      <path d="M4 19.5v-4.8h4.8" />
    </>
  ),
  chevD: <path d="M6 9.5l6 6 6-6" />,
  chevU: <path d="M6 14.5l6-6 6 6" />,
  chevL: <path d="M14.5 6l-6 6 6 6" />,
  chevR: <path d="M9.5 6l6 6-6 6" />,
  camera: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
      <circle cx="12" cy="13.7" r="3.4" />
      <path d="M9 7.5L10.4 5h3.2L15 7.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.7h17" />
      <path d="M8 2.8v3.6M16 2.8v3.6" />
      <circle cx="12" cy="14.8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.8" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  checkAll: (
    <>
      <path d="M2.5 12.5l4.5 4.5L15 7.5" />
      <path d="M11.5 16.5l1.7 1.7 7-8.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.3 2" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5c.6 4.3 2.3 6 6.6 6.6-4.3.6-6 2.3-6.6 6.6-.6-4.3-2.3-6-6.6-6.6 4.3-.6 6-2.3 6.6-6.6z" />
      <circle cx="18.6" cy="17.4" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `ic ${className}` : 'ic'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
