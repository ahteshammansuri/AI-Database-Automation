# Progress — landing page redesign

## 2026-10-19
- Audit: old page is dense (mostly 11-12 px text), code-heavy, says "Never DELETE" (wrong since ADR-010)
  and "ENTERPRISE"; tab title is "frontend".
- L1-L6: new page in frontend/src/components/landing/ (LandingNav, Hero + HeroMockup, StackMarquee, FeatureBento,
  HowItWorks, OrbitShowcase, SecuritySection, UseCases, Closing [FAQ, final CTA, footer], primitives, motion,
  navLinks); src/pages/LandingPage.tsx composes them. framer-motion only (no new dependency).
  Motion: blur-in hero, scroll-tilt product window with a looping pipeline run and live Orbit reacting to it,
  aurora + grid backgrounds, marquee, counters, spotlight hover cards, pinned 5-step scroll story with a progress
  rail, looping Orbit demo driving the real rig (labelled as an illustration), animated architecture flow,
  sliding tab pill, animated FAQ, adaptive nav (dark/light glass by section) with a scroll progress line.
- Copy checked against the code: automations only create rows (AI_ENRICH is never executed), so the products use
  case is about new entries; approval timeout options KEEP_DRAFT / AUTO_PUBLISH_LATEST / CANCEL; PostgreSQL needs
  the pgsql PHP driver; facts band uses real limits (7 DDL kinds, 48-char single-use 24 h links, 3 review rounds).
- L7: <title> and meta description; reduced motion respected (static demo states, CSS animations off);
  README §6 corrected to the ADR-010 tiers (it still said DELETE is always blocked).
- L8: headless Chrome at 1440x900 and 390x844: no console errors or exceptions, no horizontal scroll
  (scrollWidth = viewport); fixed after review: hero chips moved off mockup content, knowledge card stacked,
  nav light over light sections, security badges above titles, architecture diagram on phones.
  tsc clean; landing files 0 lint warnings; frontend tests 57/57; vite production build OK.
