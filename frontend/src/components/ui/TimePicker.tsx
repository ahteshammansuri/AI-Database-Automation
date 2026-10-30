import React, { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { usePopover } from "./usePopover";
import { formatTime12, parseHHMM, toHHMM } from "../../lib/schedule";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Minute step for the minute column (default 5). */
  step?: number;
  invalid?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Shortcut chips shown above the columns, e.g. "+15 min". */
  quickOptions?: { label: string; value: string }[];
  hint?: React.ReactNode;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 12-hour display, 24-hour value ("HH:MM"). Hour and minute columns plus typed entry. */
export const TimePicker: React.FC<TimePickerProps> = ({ value, onChange, step = 5, invalid = false, id, ariaLabel, quickOptions, hint }) => {
  const { open, toggle, close, rootRef, triggerRef, panelPosition } = usePopover(288);
  const parsed = parseHHMM(value) ?? [9, 0];
  const [typed, setTyped] = useState(value);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(parsed[1])) minutes.push(parsed[1]);
  minutes.sort((a, b) => a - b);

  useEffect(() => setTyped(value), [value]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      hourListRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "center" });
      minuteListRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "center" });
    });
  }, [open]);

  const commitTyped = () => {
    const raw = typed.trim().toUpperCase();
    const m = /^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)?$/.exec(raw);
    if (!m) {
      setTyped(value);
      return;
    }
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (m[3]) {
      if (h < 1 || h > 12) return setTyped(value);
      h = (h % 12) + (m[3] === "PM" ? 12 : 0);
    }
    if (h > 23 || min > 59) return setTyped(value);
    onChange(toHHMM(h, min));
  };

  return (
    <div className={`relative ${open ? "z-50" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${formatTime12(value)}` : undefined}
        className={`w-full flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-indigo-500/20
          ${invalid ? "border-rose-300" : open ? "border-indigo-500 ring-2 ring-indigo-500/15" : "border-slate-200 hover:border-slate-300"}`}
      >
        <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
        <span className="flex-1 font-semibold text-slate-900">{formatTime12(value)}</span>
        <span className="text-[10px] font-mono text-slate-400">{value}</span>
      </button>

      {open && (
        <div role="dialog" aria-label={ariaLabel || "Choose a time"} className={`absolute z-[100] ${panelPosition} w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl`}>
          {quickOptions && quickOptions.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quickOptions.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    onChange(q.value);
                    close(true);
                  }}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition ${q.value === value ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-indigo-50 hover:border-indigo-200"}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 px-1">Hour</div>
              <div ref={hourListRef} role="listbox" aria-label="Hour" className="h-48 overflow-y-auto pr-1 space-y-0.5">
                {HOURS.map((h) => {
                  const active = h === parsed[0];
                  return (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onClick={() => onChange(toHHMM(h, parsed[1]))}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${active ? "bg-indigo-600 text-white font-bold" : "text-slate-700 hover:bg-slate-100"}`}
                    >
                      {formatTime12(toHHMM(h, 0)).replace(":00", "")}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 px-1">Minute</div>
              <div ref={minuteListRef} role="listbox" aria-label="Minute" className="h-48 overflow-y-auto pr-1 space-y-0.5">
                {minutes.map((m) => {
                  const active = m === parsed[1];
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onClick={() => {
                        onChange(toHHMM(parsed[0], m));
                        close(true);
                      }}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-xs font-mono transition ${active ? "bg-indigo-600 text-white font-bold" : "text-slate-700 hover:bg-slate-100"}`}
                    >
                      :{String(m).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={commitTyped}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTyped();
                  close(true);
                }
              }}
              aria-label="Type a time"
              placeholder="e.g. 8:30 PM or 20:30"
              className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            <button type="button" onClick={() => close(true)} className="text-[11px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg hover:bg-slate-100">
              Done
            </button>
          </div>
          {hint && <div className="mt-2 text-[11px] text-slate-500">{hint}</div>}
        </div>
      )}
    </div>
  );
};
