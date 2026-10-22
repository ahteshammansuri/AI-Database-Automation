import React, { useState } from "react";
import { ArrowRight, Megaphone, X } from "lucide-react";
import { usePlatform } from "../../context/PlatformContext";

const TONES = {
  info: "bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 text-white",
  success: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white",
  warning: "bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950",
} as const;

const DISMISSED_KEY = "announcement_dismissed";

/**
 * The announcement an administrator turned on (admin panel › Website content), on the website and in the portal.
 * Dismissing hides it in this browser until the text changes.
 */
export const AnnouncementBar: React.FC = () => {
  const { content } = usePlatform();
  const text = content.announcement_text?.trim() ?? "";
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });

  if (!content.announcement_enabled || !text || dismissed === text) return null;

  const link = content.announcement_link && /^https?:\/\//i.test(content.announcement_link) ? content.announcement_link : null;
  const dismiss = () => {
    setDismissed(text);
    try {
      localStorage.setItem(DISMISSED_KEY, text);
    } catch {
      // Private mode: hidden for this visit only.
    }
  };

  return (
    <div role="status" className={`relative z-30 ${TONES[content.announcement_tone] ?? TONES.info}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2.5 px-10 py-2 text-center text-[13px] font-medium leading-snug">
        <Megaphone className="hidden h-4 w-4 shrink-0 opacity-80 sm:block" />
        <span>{text}</span>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="group inline-flex shrink-0 items-center gap-1 font-semibold underline decoration-current/40 underline-offset-2 hover:decoration-current">
            Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full opacity-75 transition hover:bg-black/10 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
