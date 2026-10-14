import React from "react";
import { Clock, Calendar, Palette, Cpu, Sparkles } from "lucide-react";
import { SchemaColumn } from "../../types";
import { SearchableSelect } from "./SearchableSelect";
import { InlineAiFieldAssist } from "./InlineAiFieldAssist";

export interface SchemaFieldControlProps {
  column: SchemaColumn;
  value: any;
  onChange: (val: any) => void;
  targetTable?: string;
  topic?: string;
  isRelational?: boolean;
  relationalOptions?: { id: any; label: string }[];
  loadingRelational?: boolean;
  referencedTable?: string | null;
  compact?: boolean;
  hideFieldAssist?: boolean;
}

export const isNumericType = (col: SchemaColumn | { data_type?: string }): boolean => {
  const t = (col?.data_type || "").toLowerCase();
  return (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("real")
  );
};

export const isDateTimeType = (col: SchemaColumn | { name?: string; data_type?: string }): boolean => {
  const t = (col?.data_type || "").toLowerCase();
  const n = (col?.name || "").toLowerCase();
  return (
    t.includes("datetime") ||
    t.includes("timestamp") ||
    n.includes("datetime") ||
    n.endsWith("_at") ||
    n.includes("timestamp") ||
    n === "publish_time" ||
    n === "scheduled_time"
  );
};

export const isDateOnlyType = (col: SchemaColumn | { name?: string; data_type?: string }): boolean => {
  const t = (col?.data_type || "").toLowerCase();
  const n = (col?.name || "").toLowerCase();
  return (
    (t === "date" || n.endsWith("_date") || n.startsWith("date_") || n === "date") &&
    !isDateTimeType(col)
  );
};

export const isColorType = (col: SchemaColumn | { name?: string }): boolean => {
  const n = (col?.name || "").toLowerCase();
  return (
    n.includes("color") ||
    n.includes("colour") ||
    n === "hex" ||
    n.endsWith("_hex") ||
    n.startsWith("hex_") ||
    n === "bg_color" ||
    n === "text_color"
  );
};

export const isRelationalColumn = (col: SchemaColumn | { name?: string; is_foreign_key?: boolean }): boolean => {
  const n = (col?.name || "").toLowerCase();
  return Boolean(col?.is_foreign_key) || n.endsWith("_id");
};

export const canFieldHaveAiAssist = (col: SchemaColumn | { name?: string; data_type?: string; enum_values?: string[] }): boolean => {
  if (isNumericType(col as any)) return false;
  if (isDateTimeType(col as any)) return false;
  if (isDateOnlyType(col as any)) return false;
  if (isColorType(col as any)) return false;
  if (isRelationalColumn(col as any)) return false;
  if (col.enum_values && col.enum_values.length > 0) return false;
  return true;
};

const COLOR_PRESETS = [
  { label: "Indigo", hex: "#4F46E5" },
  { label: "Violet", hex: "#7C3AED" },
  { label: "Emerald", hex: "#059669" },
  { label: "Amber", hex: "#D97706" },
  { label: "Rose", hex: "#E11D48" },
  { label: "Sky", hex: "#0284C7" },
  { label: "Slate", hex: "#0F172A" },
  { label: "Light", hex: "#F8FAFC" },
];

export const SchemaFieldControl: React.FC<SchemaFieldControlProps> = ({
  column,
  value,
  onChange,
  targetTable = "posts",
  topic = "",
  isRelational = false,
  relationalOptions = [],
  loadingRelational = false,
  referencedTable = null,
  compact = false,
  hideFieldAssist = false,
}) => {
  const colName = column.name;
  const dataType = (column.data_type || "").toLowerCase();

  const isRel = isRelational || isRelationalColumn(column);
  const isEnum = Boolean(column.enum_values && column.enum_values.length > 0);
  const isColor = isColorType(column);
  const isDateTime = isDateTimeType(column);
  const isDateOnly = isDateOnlyType(column);
  const isNumeric = isNumericType(column);
  const isFloat = dataType.includes("decimal") || dataType.includes("float") || dataType.includes("double");
  const isNumericTimestamp = (isDateTime || isDateOnly) && dataType.includes("int");

  // 1. Relational Foreign Key Selector
  if (isRel) {
    return (
      <div className="relative">
        <SearchableSelect
          value={value !== undefined ? value : ""}
          onChange={(val) => onChange(Number(val) || val)}
          placeholder={loadingRelational ? "Fetching records..." : "Select related record..."}
          options={
            relationalOptions.length > 0
              ? relationalOptions.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                  badge: `ID: #${opt.id}`,
                }))
              : [
                  {
                    value: value || 1,
                    label: referencedTable ? `${referencedTable} #1 (Default Record)` : "Record #1",
                    badge: "Default",
                  },
                ]
          }
        />
        {loadingRelational && (
          <div className="absolute right-8 top-3 text-[10px] text-indigo-600 font-medium animate-pulse pointer-events-none">
            Fetching...
          </div>
        )}
      </div>
    );
  }

  // 2. Enum Dropdown Selector
  if (isEnum && column.enum_values) {
    return (
      <SearchableSelect
        value={value || column.enum_values[0] || ""}
        onChange={(val) => onChange(String(val))}
        placeholder="Select enum value..."
        options={column.enum_values.map((v) => ({
          value: v,
          label: v,
          badge: "Enum",
        }))}
      />
    );
  }

  // 3. Visual Color Picker + Hex Input + Presets
  if (isColor) {
    const rawVal = typeof value === "string" ? value.trim() : "";
    const hexVal = rawVal.startsWith("#") ? rawVal : rawVal ? `#${rawVal}` : "#4F46E5";

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {/* Native HTML Color Input Swatch */}
          <div className="relative w-9 h-9 shrink-0 rounded-xl overflow-hidden border border-slate-300 shadow-2xs cursor-pointer hover:scale-105 transition">
            <input
              type="color"
              value={hexVal.length === 7 ? hexVal : "#4F46E5"}
              onChange={(e) => onChange(e.target.value)}
              className="absolute -top-2 -left-2 w-14 h-14 cursor-pointer border-0 p-0"
              title="Click to choose color from palette"
            />
          </div>

          {/* Hex Text Input */}
          <input
            type="text"
            value={typeof value === "string" ? value : hexVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#4F46E5"
            maxLength={9}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
          />

          {/* Color Preview Swatch Pill */}
          <div
            className="px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold shadow-2xs flex items-center gap-1.5"
            style={{
              backgroundColor: hexVal,
              color: hexVal.toLowerCase() === "#ffffff" || hexVal.toLowerCase() === "#f8fafc" ? "#0f172a" : "#ffffff",
              borderColor: "#cbd5e1",
            }}
          >
            <Palette className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[65px]">{hexVal}</span>
          </div>
        </div>

        {/* Quick Color Palette Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400 font-semibold">Presets:</span>
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.hex)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-slate-200 hover:border-slate-400 transition bg-white shadow-2xs"
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-black/10 shrink-0"
                style={{ backgroundColor: p.hex }}
              />
              <span className="text-slate-700">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 4. DateTime-Local Input (With Support for Epoch Integer Storage & Human Readability)
  if (isDateTime) {
    let pickerValue = "";
    let humanReadable = "";

    if (value !== undefined && value !== null && value !== "") {
      if (typeof value === "number" || (!isNaN(Number(value)) && String(value).length >= 9)) {
        // Epoch seconds or milliseconds
        const numericVal = Number(value);
        const ms = numericVal < 10000000000 ? numericVal * 1000 : numericVal;
        const d = new Date(ms);
        if (!isNaN(d.getTime())) {
          pickerValue = d.toISOString().slice(0, 16);
          humanReadable = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        }
      } else if (typeof value === "string") {
        const clean = value.replace(" ", "T");
        pickerValue = clean.slice(0, 16);
        const d = new Date(clean);
        if (!isNaN(d.getTime())) {
          humanReadable = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        }
      }
    }

    const handleDateTimeChange = (valStr: string) => {
      if (!valStr) {
        onChange(column.nullable ? null : isNumericTimestamp ? 0 : "");
        return;
      }
      if (isNumericTimestamp) {
        const ms = new Date(valStr).getTime();
        const epochSec = Math.floor(ms / 1000);
        onChange(epochSec);
      } else {
        // Standard SQL DATETIME format 'YYYY-MM-DD HH:MM:SS'
        const formatted = valStr.replace("T", " ") + (valStr.length === 16 ? ":00" : "");
        onChange(formatted);
      }
    };

    const handleSetNow = () => {
      const now = new Date();
      const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      handleDateTimeChange(localIso);
    };

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="datetime-local"
              required={!column.nullable}
              value={pickerValue}
              onChange={(e) => handleDateTimeChange(e.target.value)}
              className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
            />
          </div>
          <button
            type="button"
            onClick={handleSetNow}
            className="px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold transition shrink-0 flex items-center gap-1 shadow-2xs"
            title="Set to current date and time"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Now</span>
          </button>
        </div>

        {/* Human Readable Details & Storage Notice */}
        <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-500 px-1">
          {humanReadable ? (
            <span className="font-medium text-emerald-700 flex items-center gap-1">
              <span>📅 Formatted:</span>
              <strong>{humanReadable}</strong>
            </span>
          ) : (
            <span className="text-slate-400">Click &quot;Now&quot; or choose from calendar</span>
          )}
          {isNumericTimestamp && (
            <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200">
              Stored as Epoch: {String(value)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 5. Date-Only Input
  if (isDateOnly) {
    let dateValue = "";
    if (value) {
      if (typeof value === "number") {
        dateValue = new Date(value * 1000).toISOString().slice(0, 10);
      } else if (typeof value === "string") {
        dateValue = value.slice(0, 10);
      }
    }

    const handleDateChange = (valStr: string) => {
      if (!valStr) {
        onChange(column.nullable ? null : isNumericTimestamp ? 0 : "");
        return;
      }
      if (isNumericTimestamp) {
        const epochSec = Math.floor(new Date(valStr).getTime() / 1000);
        onChange(epochSec);
      } else {
        onChange(valStr);
      }
    };

    const handleSetToday = () => {
      const today = new Date().toISOString().slice(0, 10);
      handleDateChange(today);
    };

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <input
            type="date"
            required={!column.nullable}
            value={dateValue}
            onChange={(e) => handleDateChange(e.target.value)}
            className="flex-1 bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
          />
          <button
            type="button"
            onClick={handleSetToday}
            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition shrink-0 flex items-center gap-1"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Today</span>
          </button>
        </div>
        {isNumericTimestamp && (
          <div className="text-[10px] text-indigo-600 font-mono px-1">
            Stored as Epoch: {String(value)}
          </div>
        )}
      </div>
    );
  }

  // 6. Numeric / Integer Fields (STRICTLY NO AI FIELD ASSIST)
  if (isNumeric) {
    return (
      <div>
        <input
          type="number"
          step={isFloat ? "0.01" : "1"}
          required={!column.nullable}
          value={value !== undefined && value !== null ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(column.nullable ? null : 0);
            } else {
              onChange(isFloat ? parseFloat(raw) : parseInt(raw, 10));
            }
          }}
          className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
          placeholder="0"
        />
      </div>
    );
  }

  // 7. Text Field with Optional AI Field Assist (Allowed ONLY on Text/Varchar)
  const canAssist = !hideFieldAssist && canFieldHaveAiAssist(column);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="text"
          required={!column.nullable}
          value={value !== undefined && value !== null ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
          placeholder={`Enter ${colName}...`}
        />
        {canAssist && (
          <InlineAiFieldAssist
            fieldName={colName}
            currentValue={typeof value === "string" ? value : ""}
            topic={topic}
            targetTable={targetTable}
            onApply={(newVal) => onChange(newVal)}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
};
