import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Check, X, Wand2, ArrowRight, Loader2 } from "lucide-react";
import { api } from "../../services/api";

export interface InlineAiFieldAssistProps {
  fieldName: string;
  currentValue?: string;
  topic?: string;
  targetTable?: string;
  onApply: (newValue: string) => void;
  compact?: boolean;
}

type AssistAction = "generate" | "improve" | "shorten" | "expand" | "change_tone";

export const InlineAiFieldAssist: React.FC<InlineAiFieldAssistProps> = ({
  fieldName,
  currentValue = "",
  topic = "",
  targetTable = "posts",
  onApply,
  compact = false,
}) => {
  // STRICT GUARD: Do not allow InlineAiFieldAssist on integer, ID, date, or color fields
  const fn = (fieldName || "").toLowerCase();
  const isExcluded =
    fn.endsWith("_id") ||
    fn === "id" ||
    fn.includes("color") ||
    fn.includes("colour") ||
    fn.endsWith("_hex") ||
    fn.includes("date") ||
    fn.includes("timestamp") ||
    fn.endsWith("_at") ||
    fn.includes("count") ||
    fn.includes("amount") ||
    fn.includes("price") ||
    fn.includes("quantity") ||
    fn.includes("number");

  // Hooks run unconditionally (rules of hooks); excluded fields render nothing further below.
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedAction, setSelectedAction] = useState<AssistAction | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (isExcluded) {
    return null;
  }

  const handleAction = async (action: AssistAction, tone?: string) => {
    setSelectedAction(action);
    setLoading(true);
    setError(null);
    setSuggestion(null);
    setExplanation(null);

    try {
      const res = await api.fieldAssist({
        field_name: fieldName,
        action,
        current_value: currentValue,
        topic: topic || undefined,
        tone: tone || (action === "change_tone" ? "Professional and engaging" : undefined),
        target_table: targetTable,
      });

      if (res.success && res.suggested_value) {
        setSuggestion(res.suggested_value);
        setExplanation(res.explanation || "Suggestion generated successfully.");
      } else {
        setError("Unable to generate suggestion for this field.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to reach AI service.");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    if (suggestion !== null) {
      onApply(suggestion);
      setIsOpen(false);
      setSuggestion(null);
      setExplanation(null);
    }
  };

  const handleDiscard = () => {
    setSuggestion(null);
    setExplanation(null);
    setError(null);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="AI Field Assistant: Generate, improve, shorten, or expand"
        className={`inline-flex items-center gap-1 transition rounded-lg font-medium shadow-2xs border ${
          compact
            ? "px-1.5 py-0.5 text-[10px] bg-indigo-50/80 hover:bg-indigo-100/80 text-indigo-700 border-indigo-200/80"
            : "px-2 py-1 text-[11px] bg-slate-50 hover:bg-indigo-50/70 text-slate-600 hover:text-indigo-700 border-slate-200 hover:border-indigo-200"
        }`}
      >
        <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
        {!compact && <span>AI Assist</span>}
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3.5 space-y-3 text-xs animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>AI Field Assist: <code className="text-indigo-700 font-mono text-[11px] font-semibold">{fieldName}</code></span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Action Selector */}
          {!loading && !suggestion && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-slate-500 font-medium">Choose an action for this field:</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleAction("generate")}
                  className="px-2.5 py-1.5 text-left bg-slate-50 hover:bg-indigo-50/80 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-between"
                >
                  <span>✨ Generate Fresh</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("improve")}
                  disabled={!currentValue}
                  className="px-2.5 py-1.5 text-left bg-slate-50 hover:bg-indigo-50/80 disabled:opacity-40 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-between"
                >
                  <span>✍️ Improve Wording</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("shorten")}
                  disabled={!currentValue}
                  className="px-2.5 py-1.5 text-left bg-slate-50 hover:bg-indigo-50/80 disabled:opacity-40 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-between"
                >
                  <span>✂️ Shorten</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("expand")}
                  disabled={!currentValue}
                  className="px-2.5 py-1.5 text-left bg-slate-50 hover:bg-indigo-50/80 disabled:opacity-40 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-between"
                >
                  <span>📖 Elaborate</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("change_tone", "Authoritative & Professional")}
                  disabled={!currentValue}
                  className="px-2.5 py-1.5 text-left bg-slate-50 hover:bg-indigo-50/80 disabled:opacity-40 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-[11px] font-medium transition flex items-center justify-between col-span-2"
                >
                  <span>👔 Polish: Professional Tone</span>
                  <ArrowRight className="w-2.5 h-2.5 opacity-40" />
                </button>
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="py-6 flex flex-col items-center justify-center space-y-2 text-slate-500">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              <span className="text-xs font-medium text-slate-600">Generating suggestion...</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700">
              {error}
            </div>
          )}

          {/* Suggestion Review Card */}
          {suggestion && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Proposed Result:
                </span>
                <span className="text-[10px] text-indigo-600 font-mono">
                  {suggestion.length} chars
                  {currentValue ? ` (${suggestion.length >= currentValue.length ? "+" : ""}${suggestion.length - currentValue.length})` : ""}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-sans max-h-48 overflow-y-auto leading-relaxed select-text whitespace-pre-wrap">
                {suggestion}
              </div>

              {explanation && (
                <p className="text-[11px] text-slate-500 italic">
                  💡 {explanation}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  <span>Discard</span>
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply Suggestion</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
