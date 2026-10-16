import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Image as ImageIcon,
  Info,
  Link2,
  Search,
  Sparkles,
  XCircle,
  Cpu,
  BookOpen,
  Layers,
} from "lucide-react";
import { RichText } from "./RichText";
import { formatInstant } from "../../lib/schedule";

type Kind =
  | "title" | "summary" | "body" | "image" | "slug" | "meta_title" | "meta_description" | "keywords"
  | "datetime" | "enum" | "boolean" | "number" | "text" | "url" | "contact" | "json";

export interface ContentPreviewProps {
  payload: Record<string, any>;
  /** Version metadata from the pipeline: fields, relations, media, write_plan, issues, provider, rag ... */
  meta?: any;
  targetTable?: string;
  timezone?: string;
  publicationTime?: string | null;
  defaultTab?: "article" | "database" | "details";
  showStatusBanner?: boolean;
}

const HIDDEN_KEYS = new Set(["quality_metrics", "_idempotency_key"]);

/** Same naming rules as the server (TargetTableInspector::kind), used only when metadata is missing. */
function guessKind(col: string, value: any): Kind {
  const n = col.toLowerCase();
  if (/(^|_)(banner|image|img|thumbnail|thumb|cover|photo|picture|poster|hero|og_image|meta_img|meta_image|featured_image)(_url|_path|_src)?$/.test(n)) return "image";
  if (n === "slug" || n.endsWith("_slug")) return "slug";
  if (/^(meta_title|seo_title|og_title)$/.test(n)) return "meta_title";
  if (/^(meta_description|seo_description|og_description|meta_desc)$/.test(n)) return "meta_description";
  if (/(^|_)(keywords?|tags|meta_keywords)$/.test(n)) return "keywords";
  if (/^(title|name|headline|subject|question|heading)$/.test(n)) return "title";
  if (/^(excerpt|summary|short_description|intro|teaser|lead|subtitle|abstract|snippet)$/.test(n)) return "summary";
  if (/^(content|body|description|article|answer|text|details|html|long_description|post_content)$/.test(n)) return "body";
  if (/(_at|_date|_on)$/.test(n)) return "datetime";
  if (typeof value === "string" && value.length > 400) return "body";
  return "text";
}

function display(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const isUrl = (v: any) => typeof v === "string" && /^(https?:)?\/\//i.test(v);

export const ContentPreview: React.FC<ContentPreviewProps> = ({
  payload,
  meta,
  targetTable,
  timezone = "UTC",
  publicationTime,
  defaultTab = "article",
  showStatusBanner = true,
}) => {
  const [tab, setTab] = useState(defaultTab);

  const kinds = useMemo(() => {
    const map: Record<string, Kind> = {};
    for (const f of meta?.fields ?? []) map[f.column] = f.kind as Kind;
    for (const [k, v] of Object.entries(payload || {})) if (!map[k]) map[k] = guessKind(k, v);
    return map;
  }, [payload, meta]);

  const pick = (wanted: Kind[]) => Object.keys(payload || {}).find((c) => wanted.includes(kinds[c]) && typeof payload[c] === "string" && payload[c].trim() !== "");
  const relationCols = new Set<string>((meta?.relations ?? []).map((r: any) => r.column));
  const titleCol = pick(["title"]);
  const summaryCol = pick(["summary"]);
  const bodyCol = pick(["body"]);
  const slugCol = pick(["slug"]);
  const metaTitleCol = pick(["meta_title"]);
  const metaDescCol = pick(["meta_description"]);
  const keywordsCol = pick(["keywords"]);

  const media: any[] = meta?.media ?? [];
  const imageCols = Object.keys(payload || {}).filter((c) => kinds[c] === "image" && payload[c]);
  const images = imageCols.map((c) => {
    const m = media.find((x) => x.column === c);
    return { column: c, url: m?.url || payload[c], role: m?.role, provider: m?.provider, model: m?.model, isAi: !!m?.is_ai_generated, prompt: m?.prompt, fallback: m?.fallback_reason, width: m?.width, height: m?.height };
  }).filter((i) => isUrl(i.url) || String(i.url).startsWith("data:"));
  const hero = images.find((i) => i.role === "banner") ?? images[0];
  const otherImages = images.filter((i) => i !== hero);

  const shown = new Set([titleCol, summaryCol, bodyCol, slugCol, metaTitleCol, metaDescCol, keywordsCol, ...imageCols, ...relationCols].filter(Boolean) as string[]);
  const otherFields = Object.entries(payload || {}).filter(([k, v]) => !shown.has(k) && !HIDDEN_KEYS.has(k) && !k.startsWith("__") && (typeof v !== "object" || v === null));

  const plan = meta?.write_plan;
  const issues: any[] = meta?.issues ?? plan?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const infos = issues.filter((i) => i.level === "info");

  const tabs = [
    { id: "article" as const, label: "Content", icon: FileText },
    { id: "database" as const, label: `Database write${plan?.steps ? ` (${plan.steps.length})` : ""}`, icon: Database },
    { id: "details" as const, label: "How it was made", icon: Cpu },
  ];

  return (
    <div className="space-y-3">
      {showStatusBanner && plan && (
        errors.length === 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <span className="font-bold">Valid and ready to publish.</span>{" "}
              {plan.steps?.length > 1
                ? `${plan.steps.length} database steps run together in one transaction: ${plan.steps.filter((s: any) => s.action === "CREATE_PARENT").map((s: any) => `create in ${s.table}`).join(", ")}, then insert into ${plan.table}.`
                : `One new row will be inserted into ${plan.table}.`}
              {warnings.length > 0 && <span className="text-amber-700"> {warnings.length} note{warnings.length > 1 ? "s" : ""} below.</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <span className="font-bold">This cannot be published yet.</span> {errors[0].message}
              {errors.length > 1 && <span> (+{errors.length - 1} more on the Database tab)</span>}
            </div>
          </div>
        )
      )}

      <div role="tablist" aria-label="Preview sections" className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "article" && (
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {hero && (
            <figure className="relative bg-slate-100">
              <img src={hero.url} alt={payload[titleCol ?? ""] || "Generated image"} className="aspect-[16/9] w-full object-cover" loading="lazy" />
              <figcaption className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-slate-900/75 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                <ImageIcon className="h-3 w-3" />
                {hero.isAi ? `AI image · ${hero.provider}${hero.model ? ` ${hero.model}` : ""}` : hero.provider === "local" ? "Designed cover (local)" : hero.column}
              </figcaption>
            </figure>
          )}

          <div className="space-y-3 p-4 sm:p-6">
            {(meta?.relations ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(meta.relations as any[]).map((r) => (
                  <span key={r.column} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800">
                    <Link2 className="h-3 w-3" />
                    <span className="capitalize">{r.entity}</span>: {r.label}
                    <span className={`ml-1 rounded-full px-1.5 text-[9px] font-bold uppercase ${r.decision === "create" ? "bg-emerald-600 text-white" : "bg-white text-indigo-600"}`}>
                      {r.decision === "create" ? "new" : r.decision === "fixed" ? "fixed" : "existing"}
                    </span>
                  </span>
                ))}
              </div>
            )}

            {titleCol && <h1 className="text-xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl">{payload[titleCol]}</h1>}
            {summaryCol && <p className="text-sm leading-relaxed text-slate-600 sm:text-base">{payload[summaryCol]}</p>}
            {publicationTime && (
              <p className="text-[11px] font-medium text-slate-400">Scheduled for {formatInstant(publicationTime, timezone, { withZone: true })}</p>
            )}
            {bodyCol ? (
              <div className="border-t border-slate-100 pt-2">
                <RichText content={String(payload[bodyCol])} />
              </div>
            ) : (
              !titleCol && <p className="text-xs text-slate-500">This record has no long text field; see its values below.</p>
            )}
          </div>

          {otherImages.length > 0 && (
            <div className="border-t border-slate-100 p-4 sm:px-6">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Other images</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {otherImages.map((img) => (
                  <figure key={img.column} className="overflow-hidden rounded-xl border border-slate-200">
                    <img src={img.url} alt={img.column} className="aspect-video w-full object-cover" loading="lazy" />
                    <figcaption className="px-2 py-1 text-[10px] text-slate-500">
                      <span className="font-mono">{img.column}</span>{img.width ? ` · ${img.width}×${img.height}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {(metaTitleCol || metaDescCol || keywordsCol || slugCol) && (
            <div className="border-t border-slate-100 p-4 sm:px-6">
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Search className="h-3 w-3" /> Search and sharing preview
              </h4>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="truncate text-[11px] text-emerald-700">/{slugCol ? payload[slugCol] : "…"}</p>
                <p className="text-sm font-semibold text-indigo-700 line-clamp-1">{payload[metaTitleCol ?? ""] || payload[titleCol ?? ""] || "Untitled"}</p>
                <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">{payload[metaDescCol ?? ""] || payload[summaryCol ?? ""] || ""}</p>
                {keywordsCol && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {String(payload[keywordsCol]).split(",").map((k) => k.trim()).filter(Boolean).slice(0, 12).map((k) => (
                      <span key={k} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{k}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {otherFields.length > 0 && (
            <div className="border-t border-slate-100 p-4 sm:px-6">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Other values</h4>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {otherFields.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-slate-100 py-1">
                    <dt className="shrink-0 font-mono text-[11px] text-slate-500">{k}</dt>
                    <dd className="min-w-0 truncate text-right text-xs font-semibold text-slate-800" title={display(v)}>
                      {meta?.runtime_now?.includes(k) ? "set at publish time" : display(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </article>
      )}

      {tab === "database" && (
        <div className="space-y-3">
          {issues.length > 0 && (
            <ul className="space-y-1.5">
              {[...errors, ...warnings, ...infos].map((i, idx) => (
                <li
                  key={idx}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    i.level === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : i.level === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {i.level === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}

          {plan?.steps?.length ? (
            <>
              <p className="flex items-center gap-1.5 text-xs text-slate-600">
                <Layers className="h-3.5 w-3.5 text-indigo-600" />
                These steps run in order inside one transaction. If any step fails, none of them is saved.
              </p>
              <ol className="space-y-3">
                {plan.steps.map((s: any, idx: number) => (
                  <li key={idx} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ${s.action === "CREATE_PARENT" ? "border-emerald-100 bg-emerald-50/70" : "border-indigo-100 bg-indigo-50/60"}`}>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${s.action === "CREATE_PARENT" ? "bg-emerald-600" : "bg-indigo-600"}`}>{idx + 1}</span>
                      <span className="font-bold text-slate-900">{s.action === "CREATE_PARENT" ? "Create new record in" : "Insert into"}</span>
                      <code className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-800">{s.table}</code>
                      <span className="text-slate-500">{s.description}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(s.values ?? {}).map(([col, val]) => (
                            <tr key={col}>
                              <td className="w-1/3 whitespace-nowrap px-3 py-1.5 align-top font-mono text-[11px] text-slate-500">{col}</td>
                              <td className="px-3 py-1.5 text-slate-800">
                                <span className="line-clamp-2 break-all">{kinds[col] === "body" ? String(val).slice(0, 220) + (String(val).length > 220 ? "…" : "") : display(val)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
              No write plan was stored for this version{targetTable ? ` (table ${targetTable})` : ""}.
            </div>
          )}
        </div>
      )}

      {tab === "details" && (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Text model", meta?.provider ? `${meta.provider}${meta.model ? ` · ${meta.model}` : ""}` : meta?.manual ? "None (manual)" : "—"],
              ["Model time", meta?.latency_seconds ? `${Number(meta.latency_seconds).toFixed(1)} s` : "—"],
              ["Total time", meta?.duration_ms ? `${(meta.duration_ms / 1000).toFixed(1)} s` : "—"],
              ["Generated", meta?.generated_at ? formatInstant(meta.generated_at, timezone) : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <span className="block text-[10px] font-bold uppercase text-slate-400">{k}</span>
                <span className="font-semibold text-slate-800 break-words">{v}</span>
              </div>
            ))}
          </div>

          {media.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h4 className="mb-2 flex items-center gap-1.5 font-bold text-slate-800"><Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Images</h4>
              <ul className="space-y-2">
                {media.map((m: any) => (
                  <li key={m.column} className="flex gap-3">
                    <img src={m.url} alt={m.column} className="h-14 w-24 shrink-0 rounded-lg border border-slate-200 object-cover" loading="lazy" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800"><span className="font-mono">{m.column}</span> · {m.width}×{m.height} · {m.is_ai_generated ? `AI (${m.provider}${m.model ? ` ${m.model}` : ""})` : "designed cover (local)"}</p>
                      {m.fallback_reason && <p className="text-amber-700">{m.fallback_reason}</p>}
                      {!m.fallback_reason && m.provider_reason && <p className="text-slate-500">{m.provider_reason}</p>}
                      <p className="line-clamp-2 text-slate-500" title={m.prompt}>{m.prompt}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-2 flex items-center gap-1.5 font-bold text-slate-800"><BookOpen className="h-3.5 w-3.5 text-indigo-600" /> Knowledge base passages used</h4>
            {(meta?.rag ?? []).length > 0 ? (
              <ul className="space-y-1.5">
                {meta.rag.map((r: any, i: number) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-2 text-slate-600">
                    <span className="mr-1 font-semibold text-slate-800">Doc #{r.document_id ?? "?"}</span>{r.snippet}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">None. The content was written from the topic and settings only.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
