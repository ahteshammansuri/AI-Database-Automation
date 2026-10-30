import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Loader2, Lock, PencilLine, Plus, Search, Sparkles, X } from "lucide-react";
import { api } from "../../services/api";
import { NewRecordModal } from "./NewRecordModal";
import { blankValue, isNewLink, linkSourceText, newLink, type LinkOption, type LinkOptions, type LinkScope } from "./linkValue";
import { useDropdown } from "./useDropdown";

interface Props {
  id: string;
  scope: LinkScope;
  /** The table being filled and its linked column; the server knows where the column points. */
  table: string;
  column: string;
  value: any;
  /** The new value, and the chosen row's name when one was picked from the list. */
  onChange: (value: any, label?: string | null) => void;
  /** Offer adding a new linked row (by name, or with its details). Pickers inside that form do not. */
  allowCreate?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** The current value's name, if the page already knows it (row labels). */
  initialLabel?: string | null;
  /** The loaded link: where it points, its choices and whether new rows can be added (Orbit, help texts). */
  onLoaded?: (info: LinkOptions) => void;
}

interface Item {
  key: string;
  run: () => void;
  node: React.ReactNode;
  selected?: boolean;
}

/**
 * One picker for every linked column on every page: the linked table's rows by name (search by name or id), "none"
 * when the column allows it, and a new linked row: typed by name (saved together with this row) or entered with its
 * details in a small form when the linked table needs more than a name. A number is never typed by hand.
 */
export const LinkPicker: React.FC<Props> = ({ id, scope, table, column, value, onChange, allowCreate = true, invalid, describedBy, initialLabel, onLoaded }) => {
  const dd = useDropdown<HTMLDivElement>();
  const [info, setInfo] = useState<LinkOptions | null>(null);
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [known, setKnown] = useState<Record<string, string>>(() => (initialLabel && !blankValue(value) && !isNewLink(value) ? { [String(value)]: initialLabel } : {}));
  const [active, setActive] = useState(0);
  const [modal, setModal] = useState<{ prefill: Record<string, any> } | null>(null);
  const loadedFor = useRef<string | null>(null);
  const reportLoaded = useRef(onLoaded);
  useEffect(() => { reportLoaded.current = onLoaded; });

  const remember = (list: LinkOption[]) =>
    setKnown((k) => ({ ...k, ...Object.fromEntries(list.filter((o) => o.label).map((o) => [String(o.id), o.label as string])) }));

  // First load: where the column points, the first rows, the current value's name and what can be created.
  useEffect(() => {
    let cancelled = false;
    const key = `${scope.context}:${scope.connectionId}:${table}:${column}`;
    loadedFor.current = key;
    setLoading(true);
    setFailed(null);
    const selected = !blankValue(value) && !isNewLink(value) ? value : null;
    api.linkOptions(scope, table, column, "", selected).then((res) => {
      if (cancelled) return;
      setInfo(res);
      setOptions(res.options);
      remember(res.selected ? [...res.options, res.selected] : res.options);
      reportLoaded.current?.(res);
    }).catch((e: any) => !cancelled && setFailed(e.message || "The linked rows could not be loaded.")).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // The value only names the first selection; later changes are looked up below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.connectionId, scope.context, table, column]);

  // Search while the list is open (debounced).
  useEffect(() => {
    if (!dd.open || !info) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.linkOptions(scope, table, column, q.trim());
        if (cancelled) return;
        setOptions(res.options);
        remember(res.options);
        setFailed(null);
      } catch (e: any) {
        if (!cancelled) setFailed(e.message || "The search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dd.open, q, info]);

  // A value set from outside (Orbit, a draft) that is not named yet.
  useEffect(() => {
    if (!info || blankValue(value) || isNewLink(value) || known[String(value)] !== undefined || (info.none.allowed && value === info.none.value)) return;
    let cancelled = false;
    api.linkOptions(scope, table, column, "", value).then((res) => {
      if (!cancelled && res.selected) remember([res.selected]);
      else if (!cancelled) setKnown((k) => ({ ...k, [String(value)]: "" }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, info]);

  const thing = info?.thing ?? "record";
  const ref = info?.ref_table ?? "";
  const create = info?.create;
  const canCreate = allowCreate && !!create?.allowed;
  const isNone = !!info?.none.allowed && (value === info.none.value || (info.none.value === null && blankValue(value)));
  const typed = q.trim();
  const exact = typed !== "" && options.some((o) => (o.label ?? "").toLowerCase() === typed.toLowerCase());

  const choose = (v: any, label: string | null = null) => {
    onChange(v, label);
    dd.close();
    setQ("");
  };
  const addNew = (name: string) => {
    if (!create) return;
    if (create.mode === "details") {
      dd.close();
      setModal({ prefill: create.label_column && name ? { [create.label_column]: name } : {} });
    } else {
      choose(newLink(name, create.label_column));
    }
  };

  const items: Item[] = [];
  if (info?.none.allowed && !typed) {
    items.push({ key: "none", selected: isNone, run: () => choose(info.none.value), node: <span className="text-slate-500">None{info.none.value === 0 ? " (0, not linked)" : " (leave empty)"}</span> });
  }
  for (const o of options) {
    items.push({
      key: `o${o.id}`,
      selected: !isNewLink(value) && String(o.id) === String(value),
      run: () => choose(typeof o.id === "string" && /^\d+$/.test(o.id) ? Number(o.id) : o.id, o.label),
      node: (
        <>
          <span className={`truncate ${o.label ? "text-slate-800" : "italic text-slate-500"}`}>{o.label ?? `${thing} without a name`}</span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400">#{String(o.id)}</span>
        </>
      ),
    });
  }
  // The rows come first, then any message about them, then the ways to add a new row.
  const firstCreate = items.length;
  if (canCreate && typed && !exact && !loading) {
    items.push({
      key: "new",
      run: () => addNew(typed),
      node: <span className="flex items-center gap-1.5 font-semibold text-indigo-700"><Plus className="h-3.5 w-3.5" /> Add “{typed}” as a new {thing}{create!.mode === "details" ? "…" : ""}</span>,
    });
  }
  if (canCreate) {
    items.push({
      key: "details",
      run: () => { dd.close(); setModal({ prefill: create!.label_column && typed ? { [create!.label_column]: typed } : {} }); },
      node: <span className="flex items-center gap-1.5 text-slate-600"><PencilLine className="h-3.5 w-3.5" /> Add a new {thing} with details…</span>,
    });
  }

  useEffect(() => setActive(0), [q, dd.open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      dd.close();
    }
  };

  const renderItem = (it: Item, i: number) => (
    <button key={it.key} type="button" role="option" aria-selected={!!it.selected} onClick={it.run} onMouseEnter={() => setActive(i)}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${i === active ? "bg-indigo-50" : ""} ${it.selected ? "font-semibold text-indigo-800" : ""}`}>
      {it.node}
      {it.selected && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
    </button>
  );

  const pickedLabel = !blankValue(value) && !isNewLink(value) ? known[String(value)] : undefined;
  const missing = !!info && !loading && !blankValue(value) && !isNewLink(value) && !isNone && pickedLabel === "";

  return (
    <div className="relative" ref={dd.box}>
      {isNewLink(value) ? (
        <div id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy}
          className={`flex min-h-[2.6rem] items-center gap-2 rounded-xl border bg-indigo-50/50 px-3 py-1.5 text-[13px] ${invalid ? "border-rose-300" : "border-indigo-200"}`}>
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-semibold text-slate-900">{value.label || `New ${thing}`}</span>
            <span className="block truncate text-[11px] font-medium text-indigo-700">New {thing} · added when you save</span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {create && (
              <button type="button" onClick={() => setModal({ prefill: value.$new })} className="da-icon-btn h-7 w-7" title={`Edit the new ${thing}`} aria-label={`Edit the new ${thing}`}><PencilLine className="h-3.5 w-3.5" /></button>
            )}
            <button type="button" onClick={() => onChange(info?.none.allowed ? info.none.value : null)} className="da-icon-btn h-7 w-7" title="Remove" aria-label={`Do not add the new ${thing}`}><X className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      ) : (
        <button type="button" id={id} onClick={() => dd.toggle()} aria-haspopup="listbox" aria-expanded={dd.open}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          className={`da-input flex items-center justify-between gap-2 text-left${invalid || missing ? " da-input-invalid" : ""}`}>
          <span className="flex min-w-0 items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
            {pickedLabel ? (
              <span className="truncate text-slate-900">{pickedLabel}</span>
            ) : isNone && !blankValue(value) ? (
              <span className="text-slate-500">None</span>
            ) : missing ? (
              <span className="truncate text-rose-700">#{String(value)} is not in {ref}</span>
            ) : !blankValue(value) && !isNone ? (
              <span className="truncate font-mono text-slate-700">#{String(value)}</span>
            ) : (
              <span className="truncate text-slate-400">{failed ? "Could not load the list" : loading && !info ? "Loading…" : `Choose a ${thing}…`}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {pickedLabel && <span className="font-mono text-[11px] text-slate-400">#{String(value)}</span>}
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </span>
        </button>
      )}

      {dd.open && (
        <div className={`absolute left-0 right-0 z-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lift ${dd.up ? "bottom-full mb-1.5" : "mt-1.5"}`}>
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} aria-label={`Search ${ref}`}
              placeholder={canCreate ? `Search ${ref}, or type a new name` : `Search ${ref} by name or id`}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-[13px] focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="max-h-60 overflow-y-auto" role="listbox" aria-label={`${ref} rows`}>
            {items.slice(0, firstCreate).map((it, i) => renderItem(it, i))}
            {loading && <p className="flex items-center gap-1.5 px-2 py-2 text-[12.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</p>}
            {failed && <p className="px-2 py-2 text-[12.5px] text-rose-600">{failed}</p>}
            {!loading && !failed && options.length === 0 && (
              <p className="px-2 py-2 text-[12.5px] text-slate-500">{typed ? `No ${thing} matches “${typed}”.` : `${ref} has no rows yet.`}</p>
            )}
            {items.length > firstCreate && (
              <div className="mt-1 border-t border-slate-100 pt-1">{items.slice(firstCreate).map((it, i) => renderItem(it, firstCreate + i))}</div>
            )}
            {allowCreate && create && !create.allowed && create.reason && (
              <p className="mt-1 flex items-start gap-1.5 border-t border-slate-100 px-2 pt-2 text-[11.5px] leading-relaxed text-slate-500">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" /> <span>New {thing}s cannot be added here: {create.reason}</span>
              </p>
            )}
          </div>
          {info && (
            <p className="mt-1.5 border-t border-slate-100 px-2 pt-1.5 text-[11px] text-slate-400">
              {info.total !== null ? `${info.total.toLocaleString()} row${info.total === 1 ? "" : "s"} in ` : "From "}<span className="font-mono">{ref}</span> · {linkSourceText(info.source)}
            </p>
          )}
        </div>
      )}

      {modal && info && (
        <NewRecordModal open scope={scope} table={info.ref_table} thing={thing} prefill={modal.prefill}
          onClose={() => setModal(null)}
          onDone={(v) => { setModal(null); onChange(v); }} />
      )}
    </div>
  );
};
