// Building blocks shared by the back-office statistics: card, button group and horizontal bar list.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BAR, INK, RULE, fmtCount } from "./statsApi";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-white ${className}`} style={{ borderColor: RULE }}>
      {children}
    </div>
  );
}

/** One choice among a few buttons (period, chart or table). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  small = false,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`rounded-md border font-medium ${small ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm"}`}
            style={
              on
                ? { background: "#305D55", borderColor: "#305D55", color: "#FFFFFF" }
                : { background: "#FFFFFF", borderColor: RULE, color: INK.secondary }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tooltip body: the value leads, its label follows. */
export function BarTip({ title, value, rows }: { title: string; value: string; rows: [string, string][] }) {
  return (
    <>
      <p className="font-medium" style={{ color: INK.secondary }}>{title}</p>
      <p className="mt-0.5 text-lg font-semibold leading-tight" style={{ color: INK.primary }}>{value}</p>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {rows.map(([v, l]) => (
          <Fragment key={l}>
            <span className="text-right font-semibold tabular-nums" style={{ color: INK.primary }}>{v}</span>
            <span style={{ color: INK.secondary }}>{l}</span>
          </Fragment>
        ))}
      </div>
    </>
  );
}

export type BarItem = {
  key: string;
  label: string;
  count: number;
  /** Secondary text after the value. */
  note?: string;
  /** Read by screen readers after the visible text. */
  srText?: string;
  tip: ReactNode;
};

/**
 * Counts as thin horizontal bars (square at the baseline, 4 px rounded end), the value at the end of each bar.
 * Each row is focusable and shows its tooltip on hover and keyboard focus (on touch, on tap); the tooltip only
 * repeats what the row text and the table views already give, so it stays hidden from screen readers.
 * `valueSpace` keeps room after the longest bar for its value and note.
 */
export function BarList({ items, label, valueSpace }: { items: BarItem[]; label: string; valueSpace: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; shift: number } | null>(null);
  const max = Math.max(0, ...items.map((i) => i.count));

  // Above the active row, at the end of its bar; `shift` keeps the tooltip inside the chart's width.
  const place = useCallback(() => {
    const box = boxRef.current;
    const bar = active && box ? box.querySelector<HTMLElement>(`[data-bar="${CSS.escape(active)}"]`) : null;
    const row = bar?.closest("li");
    if (!box || !bar || !row) return setPos(null);
    const b = box.getBoundingClientRect();
    const x = bar.getBoundingClientRect().right - b.left;
    const y = row.getBoundingClientRect().top - b.top;
    const shift = b.width ? Math.min(1, Math.max(0, x / b.width)) : 0;
    setPos((p) => (p && p.x === x && p.y === y ? p : { x, y, shift }));
  }, [active]);

  useLayoutEffect(() => place(), [place, items]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [active, place]);

  const tip = active ? items.find((i) => i.key === active)?.tip : null;

  return (
    <div
      ref={boxRef}
      className="relative"
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") setActive(focused.current);
      }}
    >
      <ol role="list" aria-label={label}>
        {items.map((it) => {
          const ratio = max ? it.count / max : 0;
          return (
            <li
              key={it.key}
              tabIndex={0}
              data-active={active === it.key}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setActive(it.key);
              }}
              onFocus={(e) => {
                if (pointer.current !== "touch" && !e.currentTarget.matches(":focus-visible")) return;
                focused.current = it.key;
                setActive(it.key);
              }}
              onBlur={() => {
                if (focused.current === it.key) focused.current = null;
                setActive((k) => (k === it.key ? null : k));
              }}
              className="group grid gap-x-4 gap-y-1.5 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[#305D55] data-[active=true]:bg-[#FBF7F0] sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-center"
            >
              <span className="text-sm leading-5" style={{ color: INK.primary }}>{it.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  data-bar={it.key}
                  aria-hidden="true"
                  className="block h-4 shrink-0 rounded-r forced-color-adjust-none group-data-[active=true]:brightness-110"
                  style={{ width: ratio ? `max(2px, calc((100% - ${valueSpace}) * ${ratio}))` : 0, background: BAR }}
                />
                <span className="text-sm font-semibold leading-5" style={{ color: INK.primary }}>{fmtCount(it.count)}</span>
                {it.note && <span className="text-xs leading-5" style={{ color: INK.secondary }}>{it.note}</span>}
                {it.srText && <span className="sr-only">{it.srText}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {tip && pos && (
        <div
          aria-hidden="true"
          className="absolute z-20 w-max max-w-[16rem] rounded-md border bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: pos.x, top: pos.y - 6, transform: `translate(${-pos.shift * 100}%, -100%)`, borderColor: RULE }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}
