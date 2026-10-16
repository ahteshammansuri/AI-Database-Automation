import React from "react";

/**
 * Renders generated content (Markdown, or HTML produced by the server) as React elements.
 * No innerHTML is used: markdown is parsed into elements, and HTML is walked with DOMParser and
 * only an allowlist of tags is rebuilt (links limited to http/https/mailto), so content stored in a
 * customer database or edited by a reviewer can never inject scripts or styles into the portal.
 */

const SAFE_HREF = /^(https?:|mailto:)/i;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Order matters: code, links, bold, italic
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (m[1]) {
      out.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push(SAFE_HREF.test(lm[2])
        ? <a key={k} href={lm[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800">{lm[1]}</a>
        : lm[1]);
    } else if (m[3]) {
      out.push(<strong key={k} className="font-semibold text-slate-900">{inline(tok.slice(2, -2), k)}</strong>);
    } else if (m[4]) {
      out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k()} className="my-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-[12px] leading-relaxed text-slate-100"><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level <= 1 ? "text-xl sm:text-2xl" : level === 2 ? "text-lg sm:text-xl" : level === 3 ? "text-base sm:text-lg" : "text-sm";
      const Tag = (`h${Math.min(6, level + 1)}`) as keyof React.JSX.IntrinsicElements;
      blocks.push(<Tag key={k()} className={`${cls} mt-6 mb-2 font-bold text-slate-900 leading-snug`}>{inline(h[2], `h${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={k()} className="my-5 border-slate-200" />);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k()} className="my-3 border-l-4 border-indigo-200 bg-indigo-50/40 py-2 pl-4 pr-2 text-slate-600 italic">{inline(buf.join(" "), `q${key}`)}</blockquote>);
      continue;
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(<ul key={k()} className="my-3 list-disc space-y-1.5 pl-6 marker:text-indigo-400">{items.map((it, j) => <li key={j}>{inline(it, `u${key}-${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={k()} className="my-3 list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-indigo-500">{items.map((it, j) => <li key={j}>{inline(it, `o${key}-${j}`)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(<p key={k()} className="my-3 leading-relaxed">{inline(para.join(" "), `p${key}`)}</p>);
  }
  return blocks;
}

const ALLOWED: Record<string, string> = {
  p: "my-3 leading-relaxed",
  h1: "text-xl sm:text-2xl mt-6 mb-2 font-bold text-slate-900",
  h2: "text-lg sm:text-xl mt-6 mb-2 font-bold text-slate-900",
  h3: "text-base sm:text-lg mt-5 mb-2 font-bold text-slate-900",
  h4: "text-sm mt-4 mb-1 font-bold text-slate-900",
  h5: "text-sm mt-4 mb-1 font-semibold",
  h6: "text-sm mt-4 mb-1 font-semibold",
  ul: "my-3 list-disc space-y-1.5 pl-6",
  ol: "my-3 list-decimal space-y-1.5 pl-6",
  li: "",
  strong: "font-semibold text-slate-900",
  b: "font-semibold",
  em: "",
  i: "",
  blockquote: "my-3 border-l-4 border-indigo-200 pl-4 text-slate-600 italic",
  code: "rounded bg-slate-100 px-1 font-mono text-[0.85em]",
  pre: "my-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-[12px] text-slate-100",
  br: "",
  hr: "my-5 border-slate-200",
  a: "text-indigo-600 underline underline-offset-2",
  span: "",
  div: "",
};

function walk(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((c, j) => walk(c, `${key}-${j}`));
  if (!(tag in ALLOWED)) return <React.Fragment key={key}>{children}</React.Fragment>;
  if (tag === "br") return <br key={key} />;
  if (tag === "hr") return <hr key={key} className={ALLOWED.hr} />;
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    return SAFE_HREF.test(href)
      ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className={ALLOWED.a}>{children}</a>
      : <React.Fragment key={key}>{children}</React.Fragment>;
  }
  return React.createElement(tag, { key, className: ALLOWED[tag] || undefined }, children);
}

export function looksLikeHtml(text: string): boolean {
  return /<\/(p|h[1-6]|ul|ol|li|div|strong|em|blockquote)>/i.test(text);
}

export const RichText: React.FC<{ content: string; className?: string }> = ({ content, className = "" }) => {
  let nodes: React.ReactNode;
  if (looksLikeHtml(content) && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(content, "text/html");
    nodes = Array.from(doc.body.childNodes).map((n, j) => walk(n, `n${j}`));
  } else {
    nodes = renderMarkdown(content);
  }
  return <div className={`text-[14px] sm:text-[15px] text-slate-700 break-words ${className}`}>{nodes}</div>;
};
