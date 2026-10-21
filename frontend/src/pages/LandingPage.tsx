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

/**
 * Public product page. Every claim on it matches what the product really does (see AGENTS.md,
 * docs/DECISIONS.md ADR-010 and docs/CAPABILITIES.md); demos are labelled as illustrations.
 */
export const LandingPage: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    const root = document.documentElement;
    const prevScroll = root.style.scrollBehavior;
    document.title = "DataAuto · AI automation for your own database";
    root.style.scrollBehavior = "smooth";
    return () => {
      document.title = prevTitle;
      root.style.scrollBehavior = prevScroll;
    };
  }, []);

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
