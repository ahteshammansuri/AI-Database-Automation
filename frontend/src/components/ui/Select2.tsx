import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { orbitTargets } from "../../services/orbitTargets";

export interface SelectOption {
  value: string | number;
  label: string;
  badge?: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export type RawSelectOption = SelectOption | string | number;

export interface Select2Props {
  options: RawSelectOption[];
  value: string | number | null | undefined;
  onChange: (value: any) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  direction?: "auto" | "down" | "up";
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  showSearch?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  /** Shows the error border; pair with <FieldError id={id} /> below the select. */
  invalid?: boolean;
}

export const Select2: React.FC<Select2Props> = ({
  options: rawOptions,
  value,
  onChange,
  placeholder = "Select an option...",
  searchPlaceholder = "Type to search...",
  allowClear = false,
  disabled = false,
  size = "md",
  direction = "auto",
  className = "",
  triggerClassName = "",
  menuClassName = "",
  showSearch,
  id,
  name,
  ariaLabel,
  invalid = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [openDirection, setOpenDirection] = useState<"down" | "up">("down");

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Normalize options to SelectOption objects
  const options: SelectOption[] = useMemo(() => {
    return (rawOptions || []).map((opt) => {
      if (typeof opt === "object" && opt !== null && "value" in opt) {
        return opt as SelectOption;
      }
      return {
        value: opt,
        label: String(opt),
      };
    });
  }, [rawOptions]);

  const shouldShowSearch = showSearch !== undefined ? showSearch : options.length > 5;

  // Orbit target registration
  useEffect(() => {
    if (!id || !triggerRef.current) return;
    orbitTargets.register(id, triggerRef.current);
    return () => {
      orbitTargets.unregister(id);
    };
  }, [id]);

  // Determine direction (auto flips up if too close to viewport bottom)
  useEffect(() => {
    if (isOpen) {
      if (direction === "up") {
        setOpenDirection("up");
      } else if (direction === "down") {
        setOpenDirection("down");
      } else {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          if (spaceBelow < 250 && spaceAbove > spaceBelow) {
            setOpenDirection("up");
          } else {
            setOpenDirection("down");
          }
        }
      }
    }
  }, [isOpen, direction]);

  // Close when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      if (shouldShowSearch) {
        setTimeout(() => searchInputRef.current?.focus(), 40);
      }
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen, shouldShowSearch]);

  // Reset highlight index when query or open state changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery, isOpen]);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return options.find((opt) => String(opt.value) === String(value));
  }, [options, value]);

  // Filter options by search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        (opt.description && opt.description.toLowerCase().includes(query)) ||
        (opt.badge && opt.badge.toLowerCase().includes(query))
    );
  }, [options, searchQuery]);

  const handleSelect = useCallback(
    (optValue: string | number) => {
      onChange(optValue);
      setIsOpen(false);
      setSearchQuery("");
      triggerRef.current?.focus();
    },
    [onChange]
  );

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSearchQuery("");
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev < filteredOptions.length - 1 ? prev + 1 : 0;
        scrollIntoView(next);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : filteredOptions.length - 1;
        scrollIntoView(next);
        return next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        const chosen = filteredOptions[highlightedIndex];
        if (!chosen.disabled) {
          handleSelect(chosen.value);
        }
      }
    }
  };

  const scrollIntoView = (index: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-select-item]");
    if (items[index]) {
      (items[index] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  };

  // Size specific stylings
  const sizeStyles = {
    xs: {
      trigger: "px-2 py-1 text-[11.5px] rounded-lg gap-1.5",
      chevron: "w-3 h-3",
      option: "px-2 py-1 text-[11.5px]",
      badge: "text-[9px] px-1 py-0.2",
    },
    sm: {
      trigger: "px-2.5 py-1.5 text-xs rounded-xl gap-2",
      chevron: "w-3.5 h-3.5",
      option: "px-2.5 py-1.5 text-xs",
      badge: "text-[10px] px-1.5 py-0.5",
    },
    md: {
      trigger: "px-3 py-2 text-[13px] rounded-xl gap-2",
      chevron: "w-3.5 h-3.5",
      option: "px-3 py-2 text-[13px]",
      badge: "text-[10px] px-1.5 py-0.5",
    },
    lg: {
      trigger: "px-3.5 py-2.5 text-sm rounded-xl gap-2.5",
      chevron: "w-4 h-4",
      option: "px-3.5 py-2 text-sm",
      badge: "text-[11px] px-2 py-0.5",
    },
  }[size];

  return (
    <div
      ref={containerRef}
      className={`relative inline-block w-full text-left ${isOpen ? "z-50" : ""} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Hidden input for form submission & automated testing */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={value !== null && value !== undefined ? String(value) : ""}
        />
      )}

      {/* Select2 Trigger Button */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        className={`w-full flex items-center justify-between border font-medium transition-all text-left shadow-2xs select-none ${
          sizeStyles.trigger
        } ${
          disabled
            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
            : isOpen
            ? "bg-white border-indigo-500 ring-2 ring-indigo-500/20 text-slate-900"
            : invalid
            ? "bg-rose-50/40 border-rose-400 hover:border-rose-500 text-slate-800"
            : "bg-slate-50/70 hover:bg-white border-slate-200 hover:border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
        } ${triggerClassName}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          {selectedOption?.icon && (
            <span className="shrink-0 text-slate-500">{selectedOption.icon}</span>
          )}
          {selectedOption ? (
            <span className="font-semibold text-slate-900 truncate">
              {selectedOption.label}
            </span>
          ) : value !== null && value !== undefined && value !== "" ? (
            <span className="font-semibold text-slate-800 truncate">{String(value)}</span>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
          {selectedOption?.badge && (
            <span
              className={`font-mono bg-indigo-50 text-indigo-700 rounded border border-indigo-100 shrink-0 ${sizeStyles.badge}`}
            >
              {selectedOption.badge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-slate-400 ml-1.5">
          {allowClear && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => e.key === "Enter" && handleClear(e as any)}
              className="p-0.5 hover:text-rose-500 rounded cursor-pointer transition-colors"
              title="Clear selection"
            >
              <X className={sizeStyles.chevron} />
            </span>
          )}
          <ChevronDown
            className={`${sizeStyles.chevron} transition-transform duration-200 ${
              isOpen ? "rotate-180 text-indigo-600" : "text-slate-400"
            }`}
          />
        </div>
      </button>

      {/* Select2 Dropdown Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: openDirection === "up" ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: openDirection === "up" ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={`absolute z-[100] left-0 right-0 ${
              openDirection === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
            } min-w-[140px] bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-900/10 overflow-hidden flex flex-col max-h-64 ${menuClassName}`}
          >
            {/* Search Box */}
            {shouldShowSearch && (
              <div className="p-2 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 p-0.5 text-slate-400 hover:text-slate-600 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Options List */}
            <div ref={listRef} role="listbox" className="overflow-y-auto flex-1 p-1 space-y-0.5">
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  No matching options found
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = String(opt.value) === String(value);
                  const isHighlighted = idx === highlightedIndex;

                  return (
                    <button
                      key={String(opt.value)}
                      data-select-item
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && handleSelect(opt.value)}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg text-left transition select-none ${
                        sizeStyles.option
                      } ${
                        opt.disabled
                          ? "opacity-40 cursor-not-allowed text-slate-400"
                          : isSelected
                          ? "bg-indigo-50 text-indigo-900 font-bold"
                          : isHighlighted
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                        {opt.icon && (
                          <span className="shrink-0 text-slate-400">{opt.icon}</span>
                        )}
                        <span className="truncate">{opt.label}</span>
                        {opt.badge && (
                          <span className="px-1.5 py-0.5 text-[9px] font-mono bg-slate-100 text-slate-600 rounded border border-slate-200/60 shrink-0">
                            {opt.badge}
                          </span>
                        )}
                        {opt.description && (
                          <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
                            {opt.description}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-1.5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
