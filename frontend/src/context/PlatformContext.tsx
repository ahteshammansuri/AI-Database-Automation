import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../services/api";
import { BootSkeleton } from "../components/ui/ShellSkeletons";

/**
 * Platform settings and website texts, managed by administrators in the admin panel (Laravel). The app waits for
 * them before rendering so nothing shows a value the server does not use; they refresh when the tab regains focus.
 */
export interface PlatformConfig {
  platform: {
    brand_name: string;
    tagline: string;
    support_email: string | null;
    registration_open: boolean;
    registration_closed_message: string;
    password_min_length: number;
    knowledge_max_upload_mb: number;
    media_max_upload_mb: number;
    terms_url: string | null;
    privacy_url: string | null;
  };
  automation: { min_gap_minutes: number };
  data_explorer: { max_page_size: number; max_sample_rows: number };
  orbit: { enabled: boolean; remote_enabled: boolean };
  features: Record<string, boolean>;
}

export interface SiteContent {
  announcement_enabled: boolean;
  announcement_text: string;
  announcement_link: string | null;
  announcement_tone: "info" | "success" | "warning";
  hero_badge: string;
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
  hero_primary_cta: string;
  hero_secondary_cta: string;
  hero_points: { text: string }[];
  faq_title: string;
  faq_highlight: string;
  faq_subtitle: string;
  faqs: { question: string; answer: string }[];
  closing_title: string;
  closing_highlight: string;
  closing_subtitle: string;
  closing_cta: string;
  footer_blurb: string;
  footer_copyright: string;
  footer_stack: string;
  meta_title: string;
  meta_description: string;
  auth_title: string;
  auth_highlight: string;
  auth_subtitle: string;
  auth_points: { text: string }[];
  [sectionKey: string]: unknown;
}

/** The heading of a landing section (product, how, orbit, security, use_cases), as edited in the admin panel. */
export interface SectionText {
  eyebrow: string;
  title: string;
  highlight: string;
  titleEnd: string | null;
  subtitle: string;
}

interface PlatformContextValue {
  config: PlatformConfig;
  content: SiteContent;
  brand: string;
  section: (key: string) => SectionText;
  refresh: () => Promise<void>;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/** Re-read after the tab was hidden at least this long, so admin changes reach open tabs. */
const STALE_AFTER_MS = 60_000;

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<{ config: PlatformConfig; content: SiteContent } | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const [config, content] = await Promise.all([api.getPlatformConfig(true), api.getSiteContent(true)]);
      loadedAt.current = Date.now();
      // Default tab title for every page (index.html only has a placeholder until this loads).
      if (content?.meta_title) document.title = content.meta_title;
      setData({ config, content });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setTimeout(() => setSlow(true), 400);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_AFTER_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const section = useCallback(
    (key: string): SectionText => {
      const c = (data?.content ?? {}) as Record<string, unknown>;
      return {
        eyebrow: String(c[`${key}_eyebrow`] ?? ""),
        title: String(c[`${key}_title`] ?? ""),
        highlight: String(c[`${key}_highlight`] ?? ""),
        titleEnd: (c[`${key}_title_end`] as string | null) || null,
        subtitle: String(c[`${key}_subtitle`] ?? ""),
      };
    },
    [data],
  );

  if (!data) {
    if (failed) {
      return (
        <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
          <div className="max-w-sm text-center">
            <p className="text-[15px] font-semibold text-slate-900">The site could not be loaded</p>
            <p className="mt-1.5 text-[14px] text-slate-500">The server did not answer. Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => { setFailed(false); void load(); }}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        </div>
      );
    }
    // Usually ready within a few milliseconds; only a slow answer shows the placeholder of the screen being opened.
    return slow ? <BootSkeleton path={window.location.pathname} /> : null;
  }

  return (
    <PlatformContext.Provider value={{ config: data.config, content: data.content, brand: data.config.platform.brand_name, section, refresh: load }}>
      {children}
    </PlatformContext.Provider>
  );
};

export const usePlatform = (): PlatformContextValue => {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within a PlatformProvider");
  return ctx;
};

/** The brand name set in the admin panel, for text inside components that do not otherwise read the settings. */
export const BrandName: React.FC = () => <>{usePlatform().brand}</>;
