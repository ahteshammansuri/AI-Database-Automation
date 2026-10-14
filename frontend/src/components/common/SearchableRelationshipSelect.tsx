import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronDown, Check, Loader2, AlertCircle, Link2 } from "lucide-react";
import { api } from "../../services/api";

interface LookupRecord {
  id: string | number;
  label: string;
  [key: string]: any;
}

interface SearchableRelationshipSelectProps {
  connectionId: number;
  targetTable: string;
  value: string | number | null;
  onChange: (value: string | number, record?: LookupRecord) => void;
  placeholder?: string;
  label?: string;
  inferredReason?: string;
  disabled?: boolean;
}

export const SearchableRelationshipSelect: React.FC<SearchableRelationshipSelectProps> = ({
  connectionId,
  targetTable,
  value,
  onChange,
  placeholder = "Search and select a related record...",
  label,
  inferredReason,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [options, setOptions] = useState<LookupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<LookupRecord | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<any>(null);

  // Fetch options with optional search debouncing
  const fetchOptions = useCallback(
    async (query = "") => {
      if (!connectionId || !targetTable) return;
      try {
        setLoading(true);
        setError(null);
        const data = await api.getLookupValues(connectionId, targetTable, query);
        const records: LookupRecord[] = Array.isArray(data)
          ? data.map((item) => ({
              id: item.id ?? item.value ?? item.code,
              label: item.label ?? item.name ?? item.title ?? item.slug ?? String(item.id),
              ...item,
            }))
          : [];
        setOptions(records);

        // If a value is already selected, resolve its full record
        if (value !== null && value !== undefined) {
          const match = records.find((r) => String(r.id) === String(value));
          if (match) {
            setSelectedRecord(match);
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to load relationship records");
      } finally {
        setLoading(false);
      }
    },
    [connectionId, targetTable, value]
  );

  // Initial load
  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search query change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchOptions(query);
    }, 250);
  };

  const handleSelect = (record: LookupRecord) => {
    setSelectedRecord(record);
    onChange(record.id, record);
    setIsOpen(false);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && (
        <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
          <span>{label}</span>
          {inferredReason && (
            <span className="text-[10px] text-indigo-600 font-normal flex items-center gap-1">
              <Link2 className="w-3 h-3 text-indigo-500" />
              {inferredReason}
            </span>
          )}
        </label>
      )}

      {/* Select trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-xs text-left flex items-center justify-between transition shadow-2xs ${
          disabled
            ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
            : isOpen
            ? "border-indigo-600 ring-2 ring-indigo-500/20"
            : "border-slate-300 hover:border-slate-400 text-slate-800"
        }`}
      >
        <span className="truncate">
          {selectedRecord ? (
            <span className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">{selectedRecord.label}</span>
              <span className="text-[10px] text-slate-400 font-mono">(ID: {selectedRecord.id})</span>
            </span>
          ) : value ? (
            <span className="text-slate-700 font-mono">Record ID: {value}</span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95">
          {/* Search Input */}
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={`Search in ${targetTable}...`}
              className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {loading && <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />}
          </div>

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto p-1 text-xs">
            {error ? (
              <div className="p-3 text-center text-rose-600 flex items-center justify-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : options.length === 0 ? (
              <div className="p-4 text-center text-slate-400">
                {loading ? "Loading records..." : `No records found in table "${targetTable}"`}
              </div>
            ) : (
              options.map((opt) => {
                const isSelected = String(opt.id) === String(value);
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleSelect(opt)}
                    className={`px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between transition ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-900 font-semibold"
                        : "hover:bg-slate-100 text-slate-700"
                    }`}
                  >
                    <div className="truncate">
                      <span className="text-slate-900">{opt.label}</span>
                      <span className="text-[10px] text-slate-400 ml-2 font-mono">#{opt.id}</span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
