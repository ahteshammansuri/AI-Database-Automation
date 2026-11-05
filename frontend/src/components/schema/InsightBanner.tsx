import React from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import type { TableInsight } from "../automation/fieldPlan";

/** What the customer's AI model has read about the table, and that suggestions follow it. */
export const InsightBanner: React.FC<{ insight: TableInsight; table: string; onReread?: () => void; compact?: boolean }> = ({ insight, table, onReread, compact }) => {
  const reading = insight.status === "pending";
  const failed = insight.status === "failed" || (insight.status === "ready" && insight.source === "embeddings" && !!insight.error);
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-3.5 text-[12.5px] ${failed ? "border-amber-200 bg-amber-50/60 text-amber-900" : "border-violet-200 bg-violet-50/50 text-violet-950"}`}>
      <div className="flex min-w-0 items-start gap-2">
        {reading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-500" /> : <Brain className={`mt-0.5 h-4 w-4 shrink-0 ${failed ? "text-amber-600" : "text-violet-500"}`} />}
        <div className="min-w-0">
          <p className="font-semibold">
            {reading
              ? `Your AI model is reading ${table}${insight.progress?.total ? ` (${insight.progress.read} of ${insight.progress.total} columns)` : ""}…`
              : failed
                ? `Your AI model could not finish reading ${table}`
                : insight.source === "model"
                  ? `Read by your AI model${insight.model ? ` (${insight.model})` : ""}`
                  : `${table} was read by meaning; your AI model adds details as it answers`}
          </p>
          <p className="mt-0.5 leading-relaxed opacity-80">
            {reading
              ? `It works out what each column holds, what coded values mean and where images are kept.${compact ? "" : " The suggestions below update by themselves; you can continue meanwhile."}`
              : failed
                ? `${insight.error ?? "The model did not answer in time."} Suggestions below come from the column types and names.`
                : insight.summary ?? "The suggestions below use what it read. Change any column you want."}
          </p>
        </div>
      </div>
      {onReread && !reading && (
        <button type="button" onClick={onReread} className="da-btn da-btn-secondary da-btn-sm shrink-0"><RefreshCw className="h-3.5 w-3.5" /> Read again</button>
      )}
    </div>
  );
};
