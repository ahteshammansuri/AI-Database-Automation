import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, monthLabel, monthMatrix, WEEKDAYS } from "../../lib/schedule";

export type MarkerTone = "indigo" | "emerald" | "amber" | "slate" | "rose";

export interface DayMarker {
  tone: MarkerTone;
  title: string;
}

export interface CalendarMonthProps {
  /** YYYY-MM-DD of the visible month (any day in it) */
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  selected?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  /** Days this schedule runs on (strong highlight). */
  runDays?: Set<string>;
  /** Other activity on a day (dots), e.g. other automations. */
  markers?: Record<string, DayMarker[]>;
  min?: string | null;
  max?: string | null;
  onSelect?: (date: string) => void;
  /** Accessible label for the grid. */
  label?: string;
}

const DOT: Record<MarkerTone, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
  rose: "bg-rose-500",
};

/**
 * Monday-first month grid with keyboard navigation (arrows, Home/End, PageUp/PageDown, Enter).
 * Shows the selected day, a date range, the days a schedule runs, and dots for other activity.
 */
export const CalendarMonth: React.FC<CalendarMonthProps> = ({
  month,
  onMonthChange,
  today,
  selected,
  rangeStart,
  rangeEnd,
  runDays,
  markers,
  min,
  max,
  onSelect,
  label = "Choose a date",
}) => {
  const [y, m] = month.split("-").map(Number);
  const weeks = useMemo(() => monthMatrix(y, m - 1), [y, m]);
  const [focused, setFocused] = useState<string>(selected || today);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusOnRender = useRef(false);

  useEffect(() => {
    if (selected) setFocused(selected);
  }, [selected]);

  useEffect(() => {
    if (focusOnRender.current) {
      focusOnRender.current = false;
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
    }
  }, [focused, month]);

  const isDisabled = (d: string) => (!!min && d < min) || (!!max && d > max);
  const shiftMonth = (delta: number) => {
    const first = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(`${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-01`);
  };

  const moveFocus = (next: string) => {
    focusOnRender.current = true;
    setFocused(next);
    if (next.slice(0, 7) !== month.slice(0, 7)) onMonthChange(`${next.slice(0, 7)}-01`);
  };

  const onKeyDown = (e: React.KeyboardEvent, date: string) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(addDays(date, map[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      moveFocus(addDays(date, e.key === "PageUp" ? -28 : 28));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveFocus(`${month.slice(0, 7)}-${e.key === "Home" ? "01" : String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`);
    } else if ((e.key === "Enter" || e.key === " ") && !isDisabled(date)) {
      e.preventDefault();
      onSelect?.(date);
    }
  };

  const minMonth = min ? min.slice(0, 7) : null;
  const maxMonth = max ? max.slice(0, 7) : null;

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!!minMonth && month.slice(0, 7) <= minMonth}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-slate-900" aria-live="polite">{monthLabel(y, m - 1)}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!!maxMonth && month.slice(0, 7) >= maxMonth}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div role="grid" aria-label={label} ref={gridRef} className="w-full">
        <div role="row" className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w.iso} role="columnheader" aria-label={w.long} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1">
              {w.short.slice(0, 2)}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7">
            {week.map(({ date, inMonth }) => {
              const disabled = isDisabled(date);
              const isSelected = date === selected;
              const isToday = date === today;
              const inRange = !!rangeStart && !!rangeEnd && date >= rangeStart && date <= rangeEnd;
              const isRangeEdge = date === rangeStart || date === rangeEnd;
              const runs = runDays?.has(date);
              const dayMarkers = markers?.[date] ?? [];
              const titleParts = [
                runs ? "This automation runs" : "",
                ...dayMarkers.map((mk) => mk.title),
              ].filter(Boolean);

              return (
                <div role="gridcell" key={date} className={`relative py-0.5 ${inRange ? "bg-indigo-50" : ""} ${date === rangeStart ? "rounded-l-lg" : ""} ${date === rangeEnd ? "rounded-r-lg" : ""}`}>
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focused ? 0 : -1}
                    disabled={disabled}
                    aria-selected={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${date}${titleParts.length ? ": " + titleParts.join("; ") : ""}`}
                    title={titleParts.join("\n") || undefined}
                    onClick={() => !disabled && onSelect?.(date)}
                    onKeyDown={(e) => onKeyDown(e, date)}
                    onFocus={() => setFocused(date)}
                    className={`relative mx-auto flex h-9 w-9 sm:h-9 sm:w-9 flex-col items-center justify-center rounded-lg text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1
                      ${disabled ? "text-slate-300 cursor-not-allowed" : "cursor-pointer"}
                      ${isSelected || isRangeEdge
                        ? "bg-indigo-600 text-white font-bold shadow-sm"
                        : runs
                        ? "bg-indigo-100 text-indigo-800 font-bold hover:bg-indigo-200"
                        : !inMonth
                        ? "text-slate-300 hover:bg-slate-50"
                        : disabled
                        ? ""
                        : "text-slate-700 hover:bg-slate-100"}
                      ${isToday && !isSelected && !isRangeEdge ? "ring-1 ring-inset ring-indigo-400" : ""}`}
                  >
                    <span>{Number(date.slice(8))}</span>
                    {dayMarkers.length > 0 && (
                      <span className="absolute bottom-1 flex gap-0.5" aria-hidden="true">
                        {dayMarkers.slice(0, 3).map((mk, i) => (
                          <span key={i} className={`h-1 w-1 rounded-full ${isSelected || isRangeEdge ? "bg-white" : DOT[mk.tone]}`} />
                        ))}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
