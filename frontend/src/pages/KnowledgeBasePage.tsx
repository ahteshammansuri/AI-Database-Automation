import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Upload, Trash2, Search, FileText, CheckCircle2, AlertCircle, FileCode, FileSpreadsheet, Layers, ArrowUpRight, HardDrive, HelpCircle, X } from "lucide-react";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useRefreshAfterOrbit } from "../hooks/useRefreshAfterOrbit";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { orbitTargets } from "../services/orbitTargets";
import { actionTarget, fieldTarget } from "../services/orbitSurfaces";
import { api } from "../services/api";
import { KnowledgeDocument } from "../types";
import { StatusPill } from "../components/common/StatusPill";
import { CardHeader, EmptyState, FieldError, Loading, PageHeader } from "../components/ui/kit";
import { ariaFor, clearError, focusFirstError, invalid, knowledgeFileRules, rules, serverFieldErrors, validate, validateField, type FieldErrors } from "../lib/validation";
import { useToast } from "../context/ToastContext";
import { pageStateService } from "../services/pageStateService";

export const KnowledgeBasePage: React.FC = () => {
  const { toast, confirm } = useToast();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [showRagExplainer, setShowRagExplainer] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Messages under the title, file and search inputs.
  const [errors, setErrors] = useState<FieldErrors>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = async () => {
    try {
      setLoading(true);
      const list = await api.listKnowledge();
      setDocs(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error(err);
      setMsg({ type: "error", text: `Failed to load documents: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/knowledge", "Knowledge Base");
    loadDocs();

  }, []);

  // ---- Orbit surface (row = document id). The browser cannot pick a file for the user:
  // Orbit opens the picker and the user chooses the file. ------------------------------------
  const titleRef = useOrbitTarget<HTMLInputElement>(fieldTarget("knowledge.page", "title"));
  const searchRef = useOrbitTarget<HTMLInputElement>(fieldTarget("knowledge.page", "search"));
  const dropRef = useOrbitTarget<HTMLDivElement>(actionTarget("knowledge.page", "choose_file"));

  useRefreshAfterOrbit(["remove_knowledge_document"], () => { loadDocs(); });

  useOrbitSurface("knowledge.page", () => ({
    target: actionTarget("knowledge.page", "choose_file"),
    describe: () => ({
      documents: docs.map((d: any) => ({ id: d.id, title: d.title, type: d.file_type, status: d.status, chunks: d.chunk_count })),
      last_search: searchResults.slice(0, 3).map((r: any) => String(r.text ?? r.chunk ?? "").slice(0, 160)),
    }),
    fields: {
      title: { get: () => uploadTitle, set: (v) => { setUploadTitle(String(v ?? "").slice(0, 200)); return null; } },
      file: { get: () => uploadFile?.name ?? "", set: () => "The user must choose the file themselves (press choose_file)." },
      search: { get: () => searchQuery, set: (v) => { setSearchQuery(String(v ?? "")); return null; } },
    },
    actions: {
      refresh: { run: async () => { await loadDocs(); return { success: true, message: "Document list reloaded." }; } },
      choose_file: { run: () => { fileInputRef.current?.click(); return { success: true, message: "File picker opened; waiting for the user to choose a .md, .txt or .pdf file." }; } },
      upload: {
        enabled: () => !!uploadFile && !isUploading,
        run: async () => {
          if (!uploadFile) return { success: false, message: "No file chosen yet; ask the user to choose one (choose_file)." };
          try {
            setIsUploading(true);
            const res: any = await api.uploadKnowledge(uploadTitle || uploadFile.name, uploadFile);
            setUploadTitle("");
            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            loadDocs();
            return { success: true, message: res?.message || "Document indexed.", resource: res?.document?.id ? { type: "KnowledgeDocument", id: res.document.id } : undefined };
          } catch (err: any) {
            return { success: false, message: err.message || "Upload failed." };
          } finally {
            setIsUploading(false);
          }
        },
      },
      search: {
        run: async () => {
          if (!searchQuery.trim()) return { success: false, message: "Fill the search field first." };
          try {
            setIsSearching(true);
            const res: any = await api.queryKnowledge(searchQuery, 3);
            setSearchResults(res.matches || []);
            return { success: true, message: `${(res.matches || []).length} matching passage(s).`, data: { matches: (res.matches || []).slice(0, 3).map((m: any) => String(m.text ?? "").slice(0, 300)) } };
          } catch (err: any) {
            return { success: false, message: err.message || "Search failed." };
          } finally {
            setIsSearching(false);
          }
        },
      },
      remove: {
        target: (row) => `knowledge.row.${row}`,
        run: async (row) => {
          if (!docs.find((d: any) => String(d.id) === String(row))) return { success: false, message: `No document ${row} in the list.` };
          if (!(await askRemove(Number(row)))) return { success: false, message: "Removal was not confirmed in the popup; nothing changed." };
          try {
            await api.deleteKnowledge(Number(row));
            loadDocs();
            return { success: true, message: "Document removed." };
          } catch (err: any) {
            return { success: false, message: err.message || "Could not remove the document." };
          }
        },
      },
    },
  }));

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  /** A chosen or dropped file: checked right away, so a wrong type is explained before uploading. */
  const chooseFile = (file: File | null) => {
    setUploadFile(file);
    const problem = file ? validateField("file", { file }, { file: knowledgeFileRules }) : null;
    setErrors((x) => (problem ? { ...x, file: problem } : clearError(x, "file")));
    if (file && !problem && !uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]);
  };

  const UPLOAD_FIELD_ID: Record<string, string> = { title: "kb-title", file: "kb-file" };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate({ title: uploadTitle, file: uploadFile }, { title: [rules.maxLength(255, "Title")], file: knowledgeFileRules });
    setErrors((x) => ({ ...clearError(clearError(x, "title"), "file"), ...found }));
    if (Object.keys(found).length || !uploadFile) {
      focusFirstError(found, (f) => UPLOAD_FIELD_ID[f]);
      return;
    }

    try {
      setIsUploading(true);
      setMsg(null);
      await api.uploadKnowledge(uploadTitle.trim() || uploadFile.name, uploadFile);
      toast.success("Document Indexed", "Document chunked, embedded, and indexed in FAISS vector store.");
      setUploadTitle("");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadDocs();
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      const placed: FieldErrors = { title: fields.title, file: fields.file ?? (fields.title ? undefined : `Upload failed: ${err.message}`) } as FieldErrors;
      Object.keys(placed).forEach((k) => placed[k] === undefined && delete placed[k]);
      setErrors((x) => ({ ...x, ...placed }));
      focusFirstError(placed, (f) => UPLOAD_FIELD_ID[f]);
    } finally {
      setIsUploading(false);
    }
  };

  // Shared by the Remove button and Orbit's remove action, so both see the same popup.
  function askRemove(id: number) {
    const title = docs.find((d: any) => d.id === id)?.title;
    return confirm({
      title: "Remove Knowledge Document?",
      text: `${title ? `"${title}"` : "This document"} and its vector embeddings will be permanently removed from your knowledge index.`,
      confirmButtonText: "Yes, Remove",
      cancelButtonText: "Cancel",
    });
  }

  const handleDelete = async (id: number) => {
    if (!(await askRemove(id))) return;
    try {
      await api.deleteKnowledge(id);
      toast.success("Document Removed", "Knowledge document removed from your index.");
      loadDocs();
    } catch (err: any) {
      toast.error("Delete Failed", err.message);
    }
  };

  const handleTestSearch = async () => {
    const problem = validateField("query", { query: searchQuery }, {
      query: [rules.required("Search text", "Type a question to search your documents."), rules.maxLength(500, "Search text")],
    });
    if (problem) {
      setErrors((x) => ({ ...x, query: problem }));
      document.getElementById("kb-search")?.focus();
      return;
    }
    try {
      setIsSearching(true);
      const res = await api.queryKnowledge(searchQuery, 3);
      setSearchResults(res.matches || []);
      if (!res.matches || res.matches.length === 0) {
        toast.info("No Matches", "No similar document chunks found for this query.");
      }
    } catch (err: any) {
      setErrors((x) => ({ ...x, query: serverFieldErrors(err).query ?? `Search failed: ${err.message}` }));
    } finally {
      setIsSearching(false);
    }
  };

  const getFileIcon = (filename?: string, fileType?: string) => {
    const fn = (filename || "").toLowerCase();
    const ft = (fileType || "").toLowerCase();
    if (fn.endsWith(".pdf") || ft.includes("pdf")) return <FileSpreadsheet className="w-4 h-4 text-rose-500" />;
    if (fn.endsWith(".md") || fn.endsWith(".markdown") || ft.includes("md") || ft.includes("markdown")) return <FileCode className="w-4 h-4 text-indigo-500" />;
    return <FileText className="w-4 h-4 text-emerald-500" />;
  };

  return (
    <motion.div id="knowledge-upload-anchor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Knowledge base"
        description="Upload your guides, product facts and brand voice. Drafts and Orbit's answers use the passages retrieved from your own documents."
        actions={
          <span className="da-chip da-chip-indigo px-3 py-1.5 text-[12.5px]">
            <HardDrive className="h-3.5 w-3.5" /> {docs.length} document{docs.length === 1 ? "" : "s"} indexed
          </span>
        }
      />

      <AnimatePresence mode="wait">
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-[13px] ${
              msg.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span className="flex items-center gap-2.5 font-medium">
              {msg.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              {msg.text}
            </span>
            <button type="button" onClick={() => setMsg(null)} className="da-icon-btn h-7 w-7" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Upload */}
        <div className="da-card space-y-5 p-6">
          <CardHeader icon={Upload} title="Add a document" description="Markdown, TXT or PDF, up to 10 MB" />
          <form onSubmit={handleUpload} noValidate className="space-y-4">
            <div>
              <label className="da-label" htmlFor="kb-title">Title</label>
              <input id="kb-title" type="text" placeholder="e.g. Editorial brand and tone guide" ref={titleRef}
                value={uploadTitle} onChange={(e) => { setUploadTitle(e.target.value); setErrors((x) => clearError(x, "title")); }}
                className={`da-input${invalid(errors.title)}`} {...ariaFor("kb-title", errors.title)} />
              <FieldError id="kb-title" message={errors.title} />
              {!errors.title && <p className="da-help">Optional. The file name is used when left empty.</p>}
            </div>
            <div>
              <span className="da-label">File</span>
              <div
                id="kb-file"
                ref={dropRef}
                role="button"
                tabIndex={0}
                aria-label={uploadFile ? `Chosen file: ${uploadFile.name}. Press to change.` : "Choose a file to upload"}
                {...ariaFor("kb-file", errors.file)}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15 ${
                  isDragging
                    ? "scale-[1.01] border-indigo-500 bg-indigo-50/60"
                    : errors.file
                      ? "border-rose-300 bg-rose-50/40"
                      : uploadFile
                        ? "border-emerald-300 bg-emerald-50/40"
                        : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt,.pdf"
                  onChange={(e) => chooseFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {uploadFile ? (
                  <div className="space-y-2">
                    {errors.file ? (
                      <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-rose-500 text-white"><AlertCircle className="h-5 w-5" /></div>
                    ) : (
                      <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500 text-white shadow-[0_10px_24px_-10px_rgba(16,185,129,0.9)]"><CheckCircle2 className="h-5 w-5" /></div>
                    )}
                    <p className="mx-auto max-w-[220px] truncate text-[13px] font-bold text-slate-900">{uploadFile.name}</p>
                    <p className="font-mono text-[11.5px] text-slate-500">{(uploadFile.size / 1024).toFixed(1)} KB · click or drop to change</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-glow"><Upload className="h-5 w-5" /></div>
                    <p className="text-[13px] font-semibold text-slate-800">Drop a file here, or <span className="text-indigo-600">browse</span></p>
                    <p className="text-[12px] text-slate-400">.md · .txt · .pdf</p>
                  </div>
                )}
              </div>
              <FieldError id="kb-file" message={errors.file} />
            </div>
            <button type="submit" disabled={isUploading} className="da-btn da-btn-primary w-full py-2.5">
              {isUploading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Chunking and indexing…
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4" /> Add and index
                </>
              )}
            </button>
          </form>
        </div>

        {/* Documents */}
        <div className="da-card flex flex-col p-6 lg:col-span-2">
          <CardHeader
            icon={BookOpen}
            tone="violet"
            title={`Your documents · ${docs.length}`}
            description="Only you can see and search these."
          />
          <div className="mt-5 flex-1">
            {loading && docs.length === 0 ? (
              <Loading label="Loading documents…" className="py-14" />
            ) : docs.length === 0 ? (
              <EmptyState icon={BookOpen} title="No documents yet" description="Upload Markdown, TXT or PDF files so drafts and answers can use your facts." className="py-10" />
            ) : (
              <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                <AnimatePresence>
                  {docs.map((d, i) => (
                    <motion.div
                      key={d.id}
                      ref={(el: HTMLDivElement | null) =>
                        el ? orbitTargets.register(`knowledge.row.${d.id}`, el) : orbitTargets.unregister(`knowledge.row.${d.id}`)
                      }
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ delay: Math.min(i, 8) * 0.04 }}
                      className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 transition-all hover:border-indigo-200 hover:shadow-soft"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50">
                          {getFileIcon(d.filename || (d as any).file_path, (d as any).file_type)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate text-[14px] font-semibold text-slate-900">{d.title}</h4>
                          <p className="mt-0.5 truncate font-mono text-[11.5px] text-slate-500">
                            {d.filename || ((d as any).file_path ? (d as any).file_path.split("/").pop() : ((d as any).file_type ? `doc.${(d as any).file_type}` : "document"))} ·{" "}
                            <span className="font-semibold text-indigo-600">{d.chunk_count || 0} chunks</span> · {(((d as any).file_size || (d as any).file_size_bytes || 0) / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-2">
                        <StatusPill status={d.status || "INDEXED"} size="sm" />
                        <button type="button" onClick={() => handleDelete(d.id)} className="da-icon-btn h-8 w-8 hover:bg-rose-50 hover:text-rose-600" title="Remove document" aria-label={`Remove ${d.title}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-[12px] text-slate-500">
            <span>Embeddings run locally with nomic-embed-text through Ollama.</span>
            <span>Without it, search falls back to keyword matching.</span>
          </div>
        </div>
      </div>

      {/* Retrieval test */}
      <div className="da-card space-y-5 p-6">
        <CardHeader
          icon={Search}
          tone="cyan"
          title="Test retrieval"
          description="Search your documents the way drafts do, and see which passages come back and how closely they match."
          actions={
            <button type="button" onClick={() => setShowRagExplainer(!showRagExplainer)} className="da-btn da-btn-sm border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
              <HelpCircle className="h-3.5 w-3.5" /> {showRagExplainer ? "Hide guide" : "How does this work?"}
            </button>
          }
        />

        <AnimatePresence>
          {showRagExplainer && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 p-4 text-[13px] text-slate-600 md:grid-cols-3">
                {[
                  ["1. Split and index", "Each document is split into small passages and indexed as vector embeddings."],
                  ["2. Search by meaning", "Your query becomes a vector too, so matches are found by meaning, not only exact words."],
                  ["3. See the evidence", "The top passages are shown with their similarity, the same ones a draft would use."],
                ].map(([t, b]) => (
                  <div key={t} className="rounded-xl border border-indigo-100 bg-white/90 p-3.5">
                    <strong className="block text-[13.5px] text-slate-900">{t}</strong>
                    <p className="mt-1 leading-relaxed">{b}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="kb-search" type="text" ref={searchRef} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setErrors((x) => clearError(x, "query")); }}
              placeholder="Ask something your documents should answer…" className={`da-input pl-10${invalid(errors.query)}`} {...ariaFor("kb-search", errors.query)}
              aria-label="Search your documents"
              onKeyDown={(e) => e.key === "Enter" && handleTestSearch()} />
          </div>
          <button type="button" onClick={handleTestSearch} disabled={isSearching || docs.length === 0} className="da-btn da-btn-primary px-5">
            {isSearching ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> Searching…
              </>
            ) : (
              <>
                Search <ArrowUpRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
        <FieldError id="kb-search" message={errors.query} className="-mt-1" />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-slate-400">Try:</span>
          {["Database Indexing", "Cloud Architecture", "Schema Optimization", "API Best Practices"].map((tag) => (
            <button key={tag} type="button" onClick={() => { setSearchQuery(tag); setErrors((x) => clearError(x, "query")); }}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                searchQuery === tag ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
              }`}>
              {tag}
            </button>
          ))}
          {searchQuery && (
            <button type="button" onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="ml-1 text-[12px] text-slate-400 underline hover:text-slate-600">
              Clear
            </button>
          )}
        </div>

        <AnimatePresence>
          {searchResults.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden pt-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                <span>Retrieved passages</span>
                <span>Similarity</span>
              </div>
              {searchResults.map((m, idx) => {
                const raw = m.similarity_score !== undefined ? m.similarity_score : m.score;
                const pct = typeof raw === "number" ? Math.min(100, Math.max(0, raw > 1 ? raw : raw * 100)) : null;
                return (
                  <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }}
                    className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-indigo-200">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-950 text-[11px] font-bold text-white">{idx + 1}</span>
                        <span className="truncate text-[13.5px] font-semibold text-slate-900">{m.document_title || "Document passage"}</span>
                      </span>
                      {pct !== null ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                            <motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
                              className={`block h-full rounded-full ${pct > 75 ? "bg-emerald-500" : pct > 50 ? "bg-indigo-500" : "bg-amber-500"}`} />
                          </span>
                          <span className="font-mono text-[12px] font-bold text-slate-700">{pct.toFixed(1)}%</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-slate-400">no score</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3.5 font-mono text-[12px] leading-relaxed text-slate-700">{m.content || m.text}</p>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
