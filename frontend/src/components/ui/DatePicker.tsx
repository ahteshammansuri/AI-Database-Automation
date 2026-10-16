import React, { useEffect, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { CalendarMonth, DayMarker } from "./CalendarMonth";
import { usePopover } from "./usePopover";
import { formatDateShort } from "../../lib/schedule";

interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  today: string;
  min?: string | null;
  max?: string | null;
  placeholder?: string;
  clearable?: boolean;
  runDays?: Set<string>;
  markers?: Record<string, DayMarker[]>;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  invalid?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Called when the visible month changes, so callers can load markers for it. */
  onVisibleMonthChange?: (month: string) => void;
  footer?: React.ReactNode;
}

/** Date field with a custom calendar popover (keyboard accessible, never overflows on phones). */
export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  today,
  min,
  max,
  placeholder = "Choose a date",
  clearable = false,
  runDays,
  markers,
  rangeStart,
  rangeEnd,
  invalid = false,
  id,
  ariaLabel,
  onVisibleMonthChange,
  footer,
}) => {
  const { open, toggle, close, rootRef, triggerRef, panelPosition } = usePopover(312);
  const [month, setMonth] = useState<string>((value || today).slice(0, 7) + "-01");

  useEffect(() => {
    if (open) setMonth((value || today).slice(0, 7) + "-01");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) onVisibleMonthChange?.(month);
  }, [month, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`w-full flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-indigo-500/20
          ${invalid ? "border-rose-300 focus:border-rose-500" : open ? "border-indigo-500 ring-2 ring-indigo-500/15" : "border-slate-200 hover:border-slate-300 focus:border-indigo-600"}`}
      >
        <CalendarIcon className="w-4 h-4 text-indigo-600 shrink-0" />
        <span className={`flex-1 truncate ${value ? "text-slate-900 font-semibold" : "text-slate-400"}`}>
          {value ? formatDateShort(value) : placeholder}
        </span>
        {clearable && value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }
            }}
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel || placeholder}
          className={`absolute z-50 ${panelPosition} w-[19.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl`}
        >
          <CalendarMonth
            month={month}
            onMonthChange={setMonth}
            today={today}
            selected={value}
            min={min}
            max={max}
            runDays={runDays}
            markers={markers}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onSelect={(d) => {
              onChange(d);
              close(true);
            }}
            label={ariaLabel || placeholder}
          />
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => {
                if ((!min || today >= min) && (!max || today <= max)) {
                  onChange(today);
                  close(true);
                } else {
                  setMonth(today.slice(0, 7) + "-01");
                }
              }}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded-md hover:bg-indigo-50"
            >
              Today
            </button>
            {footer}
            <button type="button" onClick={() => close(true)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-md hover:bg-slate-100">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
