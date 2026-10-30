import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code as CodeIcon,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link2,
  Unlink,
  Undo2,
  Redo2,
  Eraser,
  Sparkles,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize2,
  Minimize2,
  ExternalLink,
  Check,
  X,
  Image as ImageIcon,
  HelpCircle,
  FileCode,
} from "lucide-react";

export interface WysiwygEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  disabled?: boolean;
  className?: string;
  error?: string | null;
  label?: string;
  helperText?: string;
  compact?: boolean;
}

/** Sanitize HTML string to prevent injection while keeping rich content elements. */
function sanitizeHtml(dirty: string): string {
  if (typeof DOMParser === "undefined" || !dirty) return dirty || "";
  const doc = new DOMParser().parseFromString(dirty, "text/html");

  // Remove dangerous tags
  const blockedTags = ["script", "iframe", "object", "embed", "style", "form", "input", "button", "textarea", "meta", "link"];
  blockedTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  });

  // Strip dangerous attributes (e.g. onerror, onclick, javascript: links)
  const allElements = doc.querySelectorAll("*");
  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || val.startsWith("javascript:") || val.startsWith("data:text/html")) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

/** Prettify HTML string with basic indentation for the source code tab */
function formatHtml(html: string): string {
  if (!html) return "";
  let formatted = "";
  const reg = /(>)(<)(\/*)/g;
  const clean = html.replace(reg, "$1\r\n$2$3");
  let pad = 0;
  clean.split("\r\n").forEach((node) => {
    let indent = 0;
    if (node.match(/.+<\/\w[^>]*>$/)) {
      indent = 0;
    } else if (node.match(/^<\/\w/)) {
      if (pad !== 0) pad -= 1;
    } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
      indent = 1;
    } else {
      indent = 0;
    }
    formatted += "  ".repeat(Math.max(0, pad)) + node + "\n";
    pad += indent;
  });
  return formatted.trim();
}

/** Extract text content for accurate word count */
function extractPlainText(html: string): string {
  if (typeof DOMParser === "undefined" || !html) return html || "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

export const WysiwygEditor: React.FC<WysiwygEditorProps> = ({
  id,
  value = "",
  onChange,
  placeholder = "Start writing or format your article content...",
  minHeight = "280px",
  maxHeight = "520px",
  disabled = false,
  className = "",
  error,
  label,
  helperText,
  compact = false,
}) => {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Link modal / popover state
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkNewTab, setLinkNewTab] = useState(true);

  // Image modal state
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");

  // Saved range for restoring selection after popovers
  const savedRangeRef = useRef<Range | null>(null);

  // Formatting active states
  const [activeFormats, setActiveFormats] = useState<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
    ul: boolean;
    ol: boolean;
    quote: boolean;
    h1: boolean;
    h2: boolean;
    h3: boolean;
    link: boolean;
  }>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    ul: false,
    ol: false,
    quote: false,
    h1: false,
    h2: false,
    h3: false,
    link: false,
  });

  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef<string>(value);

  // Synchronize incoming value changes into the editor if not internally focused
  useEffect(() => {
    if (editorRef.current && value !== lastHtmlRef.current) {
      lastHtmlRef.current = value || "";
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value || "";
      }
    }
  }, [value]);

  // Initial load
  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML && value) {
      editorRef.current.innerHTML = value;
      lastHtmlRef.current = value;
    }
  }, []);

  // Update active formatting buttons based on current selection
  const updateActiveFormats = useCallback(() => {
    if (mode !== "visual" || typeof document === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current?.contains(sel.anchorNode)) {
      return;
    }

    try {
      const isBold = document.queryCommandState("bold");
      const isItalic = document.queryCommandState("italic");
      const isUnderline = document.queryCommandState("underline");
      const isStrike = document.queryCommandState("strikeThrough");
      const isUl = document.queryCommandState("insertUnorderedList");
      const isOl = document.queryCommandState("insertOrderedList");

      // Check block element parents
      let node: Node | null = sel.anchorNode;
      let h1 = false;
      let h2 = false;
      let h3 = false;
      let quote = false;
      let code = false;
      let link = false;

      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as HTMLElement).tagName.toLowerCase();
          if (tag === "h1") h1 = true;
          if (tag === "h2") h2 = true;
          if (tag === "h3") h3 = true;
          if (tag === "blockquote") quote = true;
          if (tag === "code" || tag === "pre") code = true;
          if (tag === "a") link = true;
        }
        node = node.parentNode;
      }

      setActiveFormats({
        bold: isBold,
        italic: isItalic,
        underline: isUnderline,
        strike: isStrike,
        code,
        ul: isUl,
        ol: isOl,
        quote,
        h1,
        h2,
        h3,
        link,
      });
    } catch {
      // Ignore queryCommandState issues
    }
  }, [mode]);

  // Listen to selection changes to update toolbar active states
  useEffect(() => {
    const handleSelChange = () => {
      updateActiveFormats();
    };
    document.addEventListener("selectionchange", handleSelChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelChange);
    };
  }, [updateActiveFormats]);

  const notifyChange = (html: string) => {
    const isBlank =
      !html ||
      html === "<p><br></p>" ||
      html === "<p></p>" ||
      html === "<br>" ||
      html.trim() === "";
    const clean = isBlank ? "" : sanitizeHtml(html);
    lastHtmlRef.current = clean;
    onChange(clean);
  };

  const handleVisualInput = () => {
    if (!editorRef.current) return;
    notifyChange(editorRef.current.innerHTML);
    updateActiveFormats();
  };

  const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    lastHtmlRef.current = val;
    onChange(val);
  };

  // Execute formatting command without losing selection
  const execCmd = (cmd: string, arg: string | null = null) => {
    if (disabled || mode !== "visual") return;
    editorRef.current?.focus();
    try {
      document.execCommand(cmd, false, arg ?? undefined);
    } catch (e) {
      console.warn("execCommand failed:", cmd, e);
    }
    handleVisualInput();
    updateActiveFormats();
  };

  // Toggle heading or block format
  const toggleBlock = (tag: "p" | "h1" | "h2" | "h3" | "blockquote" | "pre") => {
    if (disabled || mode !== "visual") return;
    editorRef.current?.focus();

    // Check if current block is already this tag
    const isCurrent =
      (tag === "h1" && activeFormats.h1) ||
      (tag === "h2" && activeFormats.h2) ||
      (tag === "h3" && activeFormats.h3) ||
      (tag === "blockquote" && activeFormats.quote) ||
      (tag === "pre" && activeFormats.code);

    const targetTag = isCurrent ? "p" : tag;

    try {
      document.execCommand("formatBlock", false, `<${targetTag}>`);
    } catch {
      try {
        document.execCommand("formatBlock", false, targetTag);
      } catch {
        // fallback
      }
    }
    handleVisualInput();
    updateActiveFormats();
  };

  // Save selection before opening modal
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      const selectedText = sel.toString();
      setLinkText(selectedText);

      // Check if cursor is on an existing link
      let node: Node | null = sel.anchorNode;
      let existingHref = "";
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === "a") {
          existingHref = (node as HTMLAnchorElement).getAttribute("href") || "";
          break;
        }
        node = node.parentNode;
      }
      setLinkUrl(existingHref);
    }
  };

  const restoreSelection = () => {
    if (savedRangeRef.current && editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
    }
  };

  const handleOpenLinkModal = () => {
    saveSelection();
    setLinkPopoverOpen(true);
  };

  const handleApplyLink = () => {
    restoreSelection();
    setLinkPopoverOpen(false);

    if (!linkUrl.trim()) {
      execCmd("unlink");
      return;
    }

    let url = linkUrl.trim();
    if (!/^(https?:|mailto:|#|\/)/i.test(url)) {
      url = "https://" + url;
    }

    // If text was specified and no text was selected, insert HTML link directly
    const sel = window.getSelection();
    if (sel && sel.isCollapsed && linkText.trim()) {
      const linkHtml = `<a href="${url}" ${linkNewTab ? 'target="_blank" rel="noopener noreferrer"' : ''}>${linkText.trim()}</a>`;
      execCmd("insertHTML", linkHtml);
    } else {
      execCmd("createLink", url);
      // Ensure target="_blank"
      if (linkNewTab && editorRef.current) {
        const links = editorRef.current.querySelectorAll(`a[href="${url}"]`);
        links.forEach((a) => {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        });
        handleVisualInput();
      }
    }
    setLinkUrl("");
    setLinkText("");
  };

  const handleRemoveLink = () => {
    execCmd("unlink");
    setActiveFormats((prev) => ({ ...prev, link: false }));
  };

  const handleOpenImageModal = () => {
    saveSelection();
    setImageModalOpen(true);
  };

  const handleApplyImage = () => {
    restoreSelection();
    setImageModalOpen(false);
    if (!imageUrl.trim()) return;

    let url = imageUrl.trim();
    const alt = imageAlt.trim() || "Illustration";
    const imgHtml = `<img src="${url}" alt="${alt}" class="my-4 max-w-full rounded-2xl border border-slate-200/80 shadow-xs" />`;
    execCmd("insertHTML", imgHtml);
    setImageUrl("");
    setImageAlt("");
  };

  // Convert pasted text into clean semantic paragraphs/spans
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const textData = e.clipboardData.getData("text/plain");
    const htmlData = e.clipboardData.getData("text/html");

    if (htmlData) {
      const cleaned = sanitizeHtml(htmlData);
      document.execCommand("insertHTML", false, cleaned);
    } else if (textData) {
      // Split double newlines into paragraphs
      const paragraphs = textData
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (paragraphs.length > 1) {
        const html = paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
        document.execCommand("insertHTML", false, html);
      } else {
        document.execCommand("insertText", false, textData);
      }
    }
    handleVisualInput();
  };

  // Statistics
  const plainText = useMemo(() => extractPlainText(value), [value]);
  const wordCount = useMemo(() => {
    const trimmed = plainText.trim();
    return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  }, [plainText]);
  const charCount = plainText.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Switch between Visual & HTML mode cleanly
  const toggleMode = (newMode: "visual" | "html") => {
    if (newMode === mode) return;
    if (newMode === "html") {
      // Swapping into HTML: read current innerHTML
      if (editorRef.current) {
        const currentHtml = editorRef.current.innerHTML;
        notifyChange(currentHtml);
      }
    } else {
      // Swapping into Visual: ensure editorRef gets latest value
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = value || "";
        }
      }, 0);
    }
    setMode(newMode);
  };

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border transition-all duration-200 ${
        error
          ? "border-rose-400 bg-rose-50/20 ring-4 ring-rose-500/10"
          : isFocused
          ? "border-indigo-500 ring-4 ring-indigo-500/10 shadow-sm"
          : "border-slate-200/90 bg-white hover:border-slate-300 shadow-2xs"
      } ${
        isFullscreen
          ? "fixed inset-4 z-50 rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col"
          : linkPopoverOpen || imageModalOpen
          ? "z-40"
          : ""
      } ${className}`}
    >
      {/* Top Header & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5 backdrop-blur-sm sm:px-3">
        {/* Left Toolbar items: Formatting controls */}
        <div className="flex flex-wrap items-center gap-1">
          {/* Visual Mode Tools */}
          {mode === "visual" ? (
            <>
              {/* Heading selector buttons */}
              <div className="flex items-center rounded-lg bg-slate-200/60 p-0.5">
                <button
                  type="button"
                  title="Paragraph / Normal Text"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleBlock("p");
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition-all ${
                    !activeFormats.h1 && !activeFormats.h2 && !activeFormats.h3 && !activeFormats.quote && !activeFormats.code
                      ? "bg-white text-indigo-700 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  P
                </button>
                <button
                  type="button"
                  title="Heading 1"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleBlock("h1");
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition-all ${
                    activeFormats.h1 ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  H1
                </button>
                <button
                  type="button"
                  title="Heading 2"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleBlock("h2");
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition-all ${
                    activeFormats.h2 ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  H2
                </button>
                <button
                  type="button"
                  title="Heading 3"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleBlock("h3");
                  }}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition-all ${
                    activeFormats.h3 ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  H3
                </button>
              </div>

              <div className="h-4 w-px bg-slate-200 mx-0.5" />

              {/* Inline formatting */}
              <button
                type="button"
                title="Bold (Ctrl+B)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("bold");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.bold ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Bold className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Italic (Ctrl+I)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("italic");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.italic ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Italic className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Underline (Ctrl+U)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("underline");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.underline ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Underline className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Strikethrough"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("strikeThrough");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.strike ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Strikethrough className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Inline Code"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed) {
                    const text = sel.toString();
                    execCmd("insertHTML", `<code class="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-indigo-700">${text}</code>`);
                  } else {
                    toggleBlock("pre");
                  }
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.code ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <CodeIcon className="h-3.5 w-3.5" />
              </button>

              <div className="h-4 w-px bg-slate-200 mx-0.5" />

              {/* Lists & Blocks */}
              <button
                type="button"
                title="Bulleted List"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("insertUnorderedList");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.ul ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Numbered List"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("insertOrderedList");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.ol ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Quote"
                onMouseDown={(e) => {
                  e.preventDefault();
                  toggleBlock("blockquote");
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.quote ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Quote className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Horizontal Rule"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("insertHorizontalRule");
                }}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>

              <div className="h-4 w-px bg-slate-200 mx-0.5" />

              {/* Links & Media */}
              <button
                type="button"
                title={activeFormats.link ? "Edit Link" : "Insert Link"}
                onClick={handleOpenLinkModal}
                className={`grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950 ${
                  activeFormats.link ? "bg-indigo-100 font-bold text-indigo-700 ring-1 ring-indigo-300" : ""
                }`}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>

              {activeFormats.link && (
                <button
                  type="button"
                  title="Remove Link"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleRemoveLink();
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-rose-600 transition-colors hover:bg-rose-100"
                >
                  <Unlink className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                title="Insert Image"
                onClick={handleOpenImageModal}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>

              <div className="h-4 w-px bg-slate-200 mx-0.5" />

              {/* Clear format & Undo/Redo */}
              <button
                type="button"
                title="Clear Formatting"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("removeFormat");
                }}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
              >
                <Eraser className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Undo (Ctrl+Z)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("undo");
                }}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Redo (Ctrl+Y)"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("redo");
                }}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[12px] font-mono text-slate-500 px-1 py-0.5">
              <FileCode className="h-3.5 w-3.5 text-indigo-600" />
              <span>Direct HTML Source Editing Mode</span>
            </div>
          )}
        </div>

        {/* Right Toolbar items: Mode Switcher & Fullscreen */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Mode Switcher pill */}
          <div className="flex items-center rounded-lg bg-slate-200/80 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => toggleMode("visual")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                mode === "visual"
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-950"
              }`}
            >
              <Sparkles className="h-3 w-3 text-indigo-500" />
              <span>Visual</span>
            </button>
            <button
              type="button"
              onClick={() => toggleMode("html")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                mode === "html"
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-950"
              }`}
            >
              <CodeIcon className="h-3 w-3 text-indigo-500" />
              <span>HTML</span>
            </button>
          </div>

          {/* Fullscreen Expand/Collapse */}
          <button
            type="button"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-950"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Editor Content Surface */}
      <div className="relative flex-1 bg-white">
        {mode === "visual" ? (
          <div
            id={id}
            ref={editorRef}
            contentEditable={!disabled}
            suppressContentEditableWarning
            onInput={handleVisualInput}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              if (editorRef.current) {
                notifyChange(editorRef.current.innerHTML);
              }
            }}
            onPaste={handlePaste}
            data-placeholder={placeholder}
            style={{
              minHeight: isFullscreen ? "calc(100vh - 180px)" : minHeight,
              maxHeight: isFullscreen ? "calc(100vh - 180px)" : maxHeight,
            }}
            className={`prose prose-slate max-w-none overflow-y-auto px-4 py-3.5 text-[14px] leading-relaxed text-slate-800 outline-none
              empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] empty:before:pointer-events-none
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-950 [&_h1]:tracking-tight [&_h1]:mt-6 [&_h1]:mb-3
              [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:tracking-tight [&_h2]:mt-5 [&_h2]:mb-2.5
              [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-slate-900 [&_h3]:mt-4 [&_h3]:mb-2
              [&_p]:my-2.5 [&_p]:leading-relaxed
              [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ul]:marker:text-indigo-500
              [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_ol]:marker:font-semibold [&_ol]:marker:text-indigo-600
              [&_li]:leading-relaxed
              [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-2.5 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:italic [&_blockquote]:text-slate-700 [&_blockquote]:rounded-r-xl
              [&_code]:rounded-md [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:text-indigo-700 [&_code]:font-medium
              [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_pre]:text-slate-100 [&_pre]:leading-relaxed
              [&_a]:text-indigo-600 [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-indigo-800 [&_a]:font-medium
              [&_hr]:my-6 [&_hr]:border-slate-200
              [&_img]:rounded-2xl [&_img]:border [&_img]:border-slate-200 [&_img]:shadow-sm
            `}
          />
        ) : (
          <textarea
            id={id ? `${id}-source` : undefined}
            value={value}
            onChange={handleSourceChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="<p>Enter HTML code directly...</p>"
            style={{
              minHeight: isFullscreen ? "calc(100vh - 180px)" : minHeight,
              maxHeight: isFullscreen ? "calc(100vh - 180px)" : maxHeight,
            }}
            className="w-full resize-y font-mono text-[13px] leading-relaxed text-slate-800 bg-slate-900/5 px-4 py-3 outline-none focus:bg-white"
          />
        )}
      </div>

      {/* Footer Info & Statistics Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-3.5 py-1.5 text-[11.5px] text-slate-500 rounded-b-2xl">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-700">{wordCount} words</span>
          <span className="h-3 w-px bg-slate-200" />
          <span>{charCount} characters</span>
          <span className="h-3 w-px bg-slate-200" />
          <span>~{readingTime} min read</span>
        </div>

        <div className="flex items-center gap-2">
          {mode === "visual" ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> WYSIWYG Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
              <FileCode className="h-3 w-3 text-indigo-500" /> HTML Source Mode
            </span>
          )}
          {isFullscreen && (
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 ml-2"
            >
              Close Fullscreen
            </button>
          )}
        </div>
      </div>

      {/* Floating Link Insertion Popover */}
      {linkPopoverOpen && (
        <div className="absolute top-12 left-4 z-[100] w-80 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl transition-all">
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Link2 className="h-3.5 w-3.5 text-indigo-600" />
              {linkUrl ? "Edit Link" : "Insert Hyperlink"}
            </span>
            <button
              type="button"
              onClick={() => setLinkPopoverOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div>
              <label className="block mb-1 font-semibold text-slate-700">Target URL</label>
              <input
                type="text"
                autoFocus
                placeholder="https://example.com/article"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyLink();
                  }
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="block mb-1 font-semibold text-slate-700">Link Text (optional)</label>
              <input
                type="text"
                placeholder="Clickable anchor text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1 text-slate-600">
              <input
                type="checkbox"
                checked={linkNewTab}
                onChange={(e) => setLinkNewTab(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Open link in new browser tab</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLinkPopoverOpen(false)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyLink}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700"
              >
                <Check className="h-3 w-3" /> Apply Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Image Insertion Popover */}
      {imageModalOpen && (
        <div className="absolute top-12 left-4 z-[100] w-80 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl transition-all">
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <ImageIcon className="h-3.5 w-3.5 text-indigo-600" /> Insert Image
            </span>
            <button
              type="button"
              onClick={() => setImageModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div>
              <label className="block mb-1 font-semibold text-slate-700">Image Web Address (URL)</label>
              <input
                type="text"
                autoFocus
                placeholder="https://images.unsplash.com/..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyImage();
                  }
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="block mb-1 font-semibold text-slate-700">Alt Text / Caption</label>
              <input
                type="text"
                placeholder="Brief description for accessibility"
                value={imageAlt}
                onChange={(e) => setImageAlt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setImageModalOpen(false)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyImage}
                disabled={!imageUrl.trim()}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Embed Image
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
