import React, { useEffect } from "react";
import { LandingNav } from "../components/landing/LandingNav";
import { Hero } from "../components/landing/Hero";
import { StackMarquee } from "../components/landing/StackMarquee";
import { FeatureBento } from "../components/landing/FeatureBento";
import { HowItWorks } from "../components/landing/HowItWorks";
import { OrbitShowcase } from "../components/landing/OrbitShowcase";
import { SecuritySection } from "../components/landing/SecuritySection";
import { UseCases } from "../components/landing/UseCases";
import { Faq, FinalCta, LandingFooter } from "../components/landing/Closing";
import { usePlatform } from "../context/PlatformContext";

/**
 * Public product page. Every claim on it matches what the product really does (see AGENTS.md,
 * docs/DECISIONS.md ADR-010 and docs/CAPABILITIES.md); demos are labelled as illustrations.
 */
export const LandingPage: React.FC = () => {
  const { content } = usePlatform();

  useEffect(() => {
    const root = document.documentElement;
    const prevScroll = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollBehavior = prevScroll;
    };
  }, []);

  // Title and description for search engines, as set in the admin panel (Website content).
  useEffect(() => {
    const prevTitle = document.title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    const prevDescription = meta.content;
    document.title = content.meta_title;
    meta.content = content.meta_description;
    return () => {
      document.title = prevTitle;
      if (created) meta?.remove();
      else if (meta) meta.content = prevDescription;
    };
  }, [content.meta_title, content.meta_description]);

  return (
    // overflow-x-clip (not hidden) keeps the pinned "How it works" story working.
    <div className="min-h-screen bg-[#060914] overflow-x-clip selection:bg-indigo-500 selection:text-white">
      <LandingNav />
      <main>
        <Hero />
        <StackMarquee />
        <FeatureBento />
        <HowItWorks />
        <OrbitShowcase />
        <SecuritySection />
        <UseCases />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
