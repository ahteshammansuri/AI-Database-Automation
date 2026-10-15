import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Upload,
  Trash2,
  Search,
  FileText,
  CheckCircle2,
  AlertCircle,
  FileCode,
  FileSpreadsheet,
  Database,
  Layers,
  ArrowUpRight,
  HardDrive,
  HelpCircle,
  Info,
  Sparkles,
} from "lucide-react";
import { api } from "../services/api";
import { KnowledgeDocument } from "../types";
import { StatusPill } from "../components/common/StatusPill";
import { useToast } from "../context/ToastContext";
import { actionBridge } from "../services/actionBridge";
import { pageStateService } from "../services/pageStateService";

export const KnowledgeBasePage: React.FC = () => {
  const { toast, showAlert } = useToast();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [showRagExplainer, setShowRagExplainer] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

    const unsubs = [
      actionBridge.on("knowledge.open_upload", (payload: any) => {
        if (payload?.title) setUploadTitle(payload.title);
        fileInputRef.current?.click();
        return { status: "ok" };
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setUploadFile(file);
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    try {
      setIsUploading(true);
      setMsg(null);
      await api.uploadKnowledge(uploadTitle || uploadFile.name, uploadFile);
      toast.success("Document Indexed", "Document chunked, embedded, and indexed in FAISS vector store.");
      setUploadTitle("");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadDocs();
    } catch (err: any) {
      toast.error("Upload Failed", err.message);
      setMsg({ type: "error", text: `Upload failed: ${err.message}` });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = (id: number) => {
    showAlert({
      title: "Remove Knowledge Document?",
      text: "This document and its vector embeddings will be permanently removed from your FAISS index.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Remove",
      cancelButtonText: "Cancel",
      onConfirm: async () => {
        try {
          await api.deleteKnowledge(id);
          toast.success("Document Removed", "Knowledge document removed from FAISS index.");
          loadDocs();
        } catch (err: any) {
          toast.error("Delete Failed", err.message);
        }
      },
    });
  };

  const handleTestSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      setIsSearching(true);
      const res = await api.queryKnowledge(searchQuery, 3);
      setSearchResults(res.matches || []);
      if (!res.matches || res.matches.length === 0) {
        toast.info("No Matches", "No similar document chunks found for this query.");
      }
    } catch (err: any) {
      toast.error("Query Failed", err.message);
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
    <motion.div
      id="knowledge-upload-anchor"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              RAG Pipeline & Embeddings
            </span>
            <span className="text-xs text-slate-400">• FAISS Vector Engine</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Knowledge Base & RAG</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest brand guidelines, documentation, and reference content. The AI microservice embeds chunks locally to enrich prompt context.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-600 flex items-center gap-2 shadow-2xs">
            <HardDrive className="w-3.5 h-3.5 text-indigo-500" />
            <span className="font-semibold text-slate-900">{docs.length}</span> Documents Indexed
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between shadow-2xs ${
              msg.type === "success"
                ? "bg-emerald-50/90 border-emerald-200 text-emerald-800"
                : "bg-rose-50/90 border-rose-200 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {msg.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-medium">{msg.text}</span>
            </div>
            <button
              onClick={() => setMsg(null)}
              className="text-slate-400 hover:text-slate-600 p-1 font-bold text-xs"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Form & Dropzone */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-600" />
              Ingest Document
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Supports .md, .txt, and .pdf documents</p>
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Document Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Editorial Brand & Tone Guidelines"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
              />
            </div>

            {/* Interactive Drag & Drop Area */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                File Attachment
              </label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-50/50 scale-[1.01]"
                    : uploadFile
                    ? "border-emerald-300 bg-emerald-50/30"
                    : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  required={!uploadFile}
                  accept=".md,.txt,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setUploadFile(f);
                    if (f && !uploadTitle) {
                      setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                  className="hidden"
                />

                {uploadFile ? (
                  <div className="space-y-1.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-bold text-slate-900 truncate max-w-[200px] mx-auto">
                      {uploadFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {(uploadFile.size / 1024).toFixed(1)} KB • Click or drop to change
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">
                        Drop your document here, or <span className="text-indigo-600">browse</span>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Markdown, TXT, or PDF up to 10MB
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isUploading || !uploadFile}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs ${
                isUploading || !uploadFile
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Chunking & Indexing Vectors...</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4" />
                  <span>Ingest & Index in Vector DB</span>
                </>
              )}
            </motion.button>
          </form>
        </motion.div>

        {/* Documents List */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                Indexed Knowledge Sources ({docs.length})
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                Isolated to your user workspace
              </span>
            </div>

            {loading && docs.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Loading indexed documents...
              </div>
            ) : docs.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-xl px-4 space-y-2">
                <BookOpen className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-medium text-slate-600">No documents indexed in your knowledge base yet.</p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Upload Markdown, TXT, or PDF files to provide rich domain context to the AI generation engine.
                </p>
              </div>
            ) : (
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.05 }
                  }
                }}
                className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1"
              >
                <AnimatePresence>
                  {docs.map((d) => (
                    <motion.div
                      key={d.id}
                      variants={{
                        hidden: { opacity: 0, y: 8 },
                        visible: { opacity: 1, y: 0 }
                      }}
                      exit={{ opacity: 0, x: -15 }}
                      whileHover={{ y: -2, borderColor: "#cbd5e1" }}
                      className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl flex items-center justify-between text-xs transition-shadow hover:shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                          {getFileIcon(d.filename || (d as any).file_path, (d as any).file_type)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-900 truncate">{d.title}</h4>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {d.filename || ((d as any).file_path ? (d as any).file_path.split("/").pop() : ((d as any).file_type ? `doc.${(d as any).file_type}` : "document"))} • <span className="text-indigo-600 font-semibold">{d.chunk_count || 0} chunks</span> • {(((d as any).file_size || (d as any).file_size_bytes || 0) / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <StatusPill status={d.status || "INDEXED"} size="sm" />
                        <motion.button
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDelete(d.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Delete from Vector Store"
                        >
                          <Trash2 className="w-4 h-4" />
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Local vector embeddings powered by sentence-transformers</span>
            <span className="font-mono text-emerald-600 font-medium">100% On-Premise Vector Privacy</span>
          </div>
        </div>
      </div>

      {/* Semantic Retrieval Diagnostic Tester */}
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-4 h-4 text-indigo-600" />
              RAG Semantic Retrieval Diagnostics
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Execute live similarity queries against your FAISS index to observe chunk scoring and context extraction
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRagExplainer(!showRagExplainer)}
              className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-200 transition flex items-center gap-1 shadow-2xs"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{showRagExplainer ? "Hide Guide" : "What is this tool?"}</span>
            </button>
            <span className="hidden sm:inline-block px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-full border border-slate-200">
              Top 3 Cosine Matches
            </span>
          </div>
        </div>

        {/* Educational Callout: What is RAG Diagnostics & Why to use it */}
        <AnimatePresence>
          {showRagExplainer && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 bg-gradient-to-r from-indigo-50/90 via-purple-50/50 to-slate-50 border border-indigo-200 rounded-xl space-y-2.5 overflow-hidden text-xs shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-950 flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Understanding RAG Semantic Retrieval & Diagnostics
                </span>
                <span className="text-[10px] text-indigo-600 font-mono font-semibold">Local FAISS + sentence-transformers</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-600">
                <div className="bg-white/90 p-3 rounded-lg border border-indigo-100 space-y-1">
                  <strong className="text-slate-900 block font-bold">1. What is RAG?</strong>
                  <p className="leading-relaxed">
                    Instead of letting the AI hallucinate or invent facts, <strong>Retrieval-Augmented Generation (RAG)</strong> breaks your uploaded guidelines or PDF manuals into small chunks and indexes them as vector embeddings.
                  </p>
                </div>
                <div className="bg-white/90 p-3 rounded-lg border border-indigo-100 space-y-1">
                  <strong className="text-slate-900 block font-bold">2. What is &quot;Semantic Query&quot;?</strong>
                  <p className="leading-relaxed">
                    Type a topic or question (e.g. <em>&quot;Database Indexing&quot;</em> or <em>&quot;Refund Policy&quot;</em>). The system converts this query into a mathematical vector to search by <strong>meaning</strong>, not just exact keywords.
                  </p>
                </div>
                <div className="bg-white/90 p-3 rounded-lg border border-indigo-100 space-y-1">
                  <strong className="text-slate-900 block font-bold">3. What does &quot;Run Diagnostic&quot; do?</strong>
                  <p className="leading-relaxed">
                    It runs a live test search against your local vector database and displays the <strong>top matching chunks</strong> with their Cosine similarity percentage. This guarantees your documents will provide the right context during content generation.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter a semantic query to test chunk similarity..."
              className="w-full bg-slate-50/50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
              onKeyDown={(e) => e.key === "Enter" && handleTestSearch()}
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleTestSearch}
            disabled={isSearching || docs.length === 0}
            className={`px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
              isSearching || docs.length === 0
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-slate-900 hover:bg-slate-800 text-white"
            }`}
          >
            {isSearching ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Searching Vectors...</span>
              </>
            ) : (
              <>
                <span>Run Diagnostic</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </>
            )}
          </motion.button>
        </div>

        {/* Quick Query Topic Presets & Doc Selectors */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-400 font-medium">Quick Topics:</span>
          {["Database Indexing", "Cloud Architecture", "Schema Optimization", "API Best Practices"].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSearchQuery(tag)}
              className={`text-[10px] px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                searchQuery === tag
                  ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                  : "bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 border-slate-200"
              }`}
            >
              + {tag}
            </button>
          ))}
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSearchResults([]);
              }}
              className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <AnimatePresence>
          {searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 pt-3 overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Retrieved Context Chunks</span>
                <span>Cosine Similarity Ranking</span>
              </div>

              {searchResults.map((m, idx) => {
                const scoreVal = m.similarity_score !== undefined ? m.similarity_score : (m.score !== undefined ? m.score : 0.85);
                const pct = Math.min(100, Math.max(0, scoreVal > 1 ? scoreVal : scoreVal * 100));
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    className="p-4 bg-slate-50/80 border border-slate-200 rounded-xl space-y-2 text-xs hover:border-indigo-200 transition"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-indigo-900">{m.document_title || "Document Chunk"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className={`h-full rounded-full ${
                              pct > 75 ? "bg-emerald-500" : pct > 50 ? "bg-indigo-500" : "bg-amber-500"
                            }`}
                          />
                        </div>
                        <span className="text-emerald-700 font-mono font-bold text-[11px]">
                          {pct.toFixed(1)}% match
                        </span>
                      </div>
                    </div>
                    <div className="p-3 bg-white border border-slate-200 rounded-lg">
                      <p className="text-slate-700 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                        {m.content || m.text}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};
