import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, HelpCircle, LayoutTemplate, ShoppingBag } from "lucide-react";
import { ManagedHeading, Reveal } from "./primitives";
import { EASE } from "./motion";

const CASES = [
  {
    id: "blog",
    icon: FileText,
    label: "Blog posts",
    title: "A steady stream of articles",
    body: "Daily or weekly posts on your topics, in your voice, with categories, unique slugs, cover images and publish dates filled in for you.",
    table: "posts",
    plan: [
      ["title", "AI writes it"],
      ["content", "AI writes it, Markdown or HTML"],
      ["category_id", "Picks or creates a category"],
      ["banner", "Generated cover image"],
      ["published_at", "The publication time"],
    ],
  },
  {
    id: "products",
    icon: ShoppingBag,
    label: "Product descriptions",
    title: "Catalog copy that stays on brand",
    body: "New catalog entries with names, descriptions and SEO fields written from your brand guide, while values like price are set by you.",
    table: "products",
    plan: [
      ["name", "AI writes it"],
      ["description", "AI writes it"],
      ["meta_description", "AI writes it, short"],
      ["brand_id", "Links a brand you choose"],
      ["price", "A fixed value you set"],
    ],
  },
  {
    id: "faqs",
    icon: HelpCircle,
    label: "FAQs",
    title: "Answers grounded in your docs",
    body: "Questions and answers drawn from the guides you upload, so support pages say what your documents say.",
    table: "faqs",
    plan: [
      ["question", "AI writes it"],
      ["answer", "AI writes it from your documents"],
      ["category_id", "Picks or creates a category"],
      ["is_active", "Fixed value: 1"],
      ["created_at", "The publication time"],
    ],
  },
  {
    id: "pages",
    icon: LayoutTemplate,
    label: "Web pages",
    title: "Landing and help pages on schedule",
    body: "Page titles, slugs, body copy and meta tags for any pages table, reviewed by a person before they go live.",
    table: "pages",
    plan: [
      ["title", "AI writes it"],
      ["slug", "From the title, made unique"],
      ["body", "AI writes it, HTML"],
      ["meta_title", "AI writes it, short"],
      ["status", "Fixed value: published"],
    ],
  },
];

export const UseCases: React.FC = () => {
  const [active, setActive] = useState(0);
  const c = CASES[active];
  return (
    <section data-nav-theme="light" className="relative bg-white py-24 sm:py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <ManagedHeading section="use_cases" />
        <Reveal className="mt-12 flex justify-center">
          <div role="tablist" className="inline-flex flex-wrap justify-center gap-1 rounded-2xl bg-slate-100 p-1.5">
            {CASES.map((x, i) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={i === active}
                type="button"
                onClick={() => setActive(i)}
                className={`relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-colors ${i === active ? "text-slate-950" : "text-slate-500 hover:text-slate-800"}`}
              >
                {i === active && (
                  <motion.span layoutId="usecase-pill" transition={{ type: "spring", stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-xl bg-white shadow-sm" />
                )}
                <x.icon className="relative w-4 h-4" />
                <span className="relative">{x.label}</span>
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-10 max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="grid md:grid-cols-[1fr_1.15fr] gap-8 md:gap-12 items-center rounded-[32px] border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-6 sm:p-10"
            >
              <div>
                <span className="grid place-items-center w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-[0_14px_40px_-14px_rgba(79,70,229,0.9)]">
                  <c.icon className="w-6 h-6" />
                </span>
                <h3 className="mt-6 text-[26px] font-extrabold tracking-[-0.03em] text-slate-950">{c.title}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-slate-600">{c.body}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_30px_70px_-40px_rgba(30,27,75,0.45)] overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <span className="font-mono text-[13px] font-semibold text-slate-800">{c.table}</span>
                  <span className="text-[12px] text-slate-400">How each column is filled</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {c.plan.map(([col, how], i) => (
                    <motion.div
                      key={col}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.06 * i, duration: 0.45, ease: EASE }}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50/80 transition-colors"
                    >
                      <span className="font-mono text-[13px] text-slate-700">{col}</span>
                      <span className="text-[13px] text-slate-500 text-right">{how}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};
