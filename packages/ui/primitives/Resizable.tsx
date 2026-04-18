// packages/ui/primitives/Resizable.tsx — split-pane layout for the main workspace.
// Used by SplitMode to place Preview + Code, Code + Console, etc. side by side.
import * as React from 'react';
import { clsx } from 'clsx';

type Direction = 'horizontal' | 'vertical';

interface PaneProps {
  children: React.ReactNode;
  className?: string;
  defaultSize?: number; // percentage 0–100
  minSize?: number;     // percentage
}

interface ResizableProps {
  direction?: Direction;
  children: [React.ReactElement<PaneProps>, React.ReactElement<PaneProps>];
  className?: string;
  /** Persist key — stored in sessionStorage so layout survives tab switches */
  storageKey?: string;
}

export const ResizablePane: React.FC<PaneProps> = ({ children, className, defaultSize: _d, minSize: _m }) => (
  <div className={clsx('abw-resizable__pane', className)}>{children}</div>
);
ResizablePane.displayName = 'ResizablePane';

export const Resizable: React.FC<ResizableProps> = ({
  direction = 'horizontal',
  children,
  className,
  storageKey,
}) => {
  const [split, setSplit] = React.useState<number>(() => {
    if (storageKey) {
      const saved = sessionStorage.getItem(`abw-split-${storageKey}`);
      if (saved) return Number(saved);
    }
    return 50;
  });
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const startDrag = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent | TouchEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
      let pct =
        direction === 'horizontal'
          ? ((clientX - rect.left) / rect.width) * 100
          : ((clientY - rect.top) / rect.height) * 100;
      pct = Math.max(20, Math.min(80, pct));
      setSplit(pct);
      if (storageKey) sessionStorage.setItem(`abw-split-${storageKey}`, String(pct));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }, [dragging, direction, storageKey]);

  const [first, second] = children;

  const firstStyle: React.CSSProperties =
    direction === 'horizontal'
      ? { width: `${split}%`, minWidth: '20%' }
      : { height: `${split}%`, minHeight: '20%' };
  const secondStyle: React.CSSProperties =
    direction === 'horizontal'
      ? { width: `${100 - split}%`, minWidth: '20%' }
      : { height: `${100 - split}%`, minHeight: '20%' };

  return (
    <div
      ref={containerRef}
      className={clsx(
        'abw-resizable',
        direction === 'horizontal' ? 'abw-resizable--h' : 'abw-resizable--v',
        dragging && 'abw-resizable--dragging',
        className,
      )}
    >
      <div className="abw-resizable__pane" style={firstStyle}>{first}</div>
      {/* role="slider" is an interactive widget — keyboard + pointer control */}
      <div
        className={clsx('abw-resizable__handle', direction === 'horizontal' ? 'abw-resizable__handle--h' : 'abw-resizable__handle--v')}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        role="slider"
        aria-label={direction === 'horizontal' ? 'Resize panes horizontally' : 'Resize panes vertically'}
        aria-orientation={direction}
        aria-valuenow={Math.round(split)}
        aria-valuemin={20}
        aria-valuemax={80}
        tabIndex={0}
        onKeyDown={(e) => {
          const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 2 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -2 : 0;
          if (delta) setSplit((s) => Math.max(20, Math.min(80, s + delta)));
        }}
      />
      <div className="abw-resizable__pane" style={secondStyle}>{second}</div>
    </div>
  );
};
Resizable.displayName = 'Resizable';
