# Landing page redesign — 2026-10-19

Request: a high-end, product-company landing page that properly explains the product, its features and
how it works, with motion, hover and scroll effects.

Resume: read PROGRESS.md, then continue from the first item that is not DONE.

Rules for the copy: only claim what the product really does (AGENTS.md, ADR-010, docs/CAPABILITIES.md).
No invented metrics, customers, testimonials or pricing. MySQL/MariaDB supported; PostgreSQL through the
same adapter (needs the server's pgsql PHP driver); SQL Server and MongoDB not supported.

| # | Item | Status |
|---|------|--------|
| L1 | Split the page into src/components/landing/* (primitives: Reveal, SpotlightCard, SectionHeading, Counter) | DONE |
| L2 | Nav (transparent → glass on scroll, scroll progress bar, mobile menu) + dark aurora hero with live Orbit and an animated product mockup (scroll tilt) | DONE |
| L3 | Works-with marquee + verifiable facts band (animated counters) | DONE |
| L4 | Feature bento grid with spotlight hover and animated mini-illustrations | DONE |
| L5 | How it works: sticky scroll story (5 steps, visual changes with scroll) | DONE |
| L6 | Orbit showcase (demo conversation driving the real rig), security tiers, architecture with animated flow, use cases, FAQ, final CTA, footer | DONE |
| L7 | Page title/meta; reduced-motion support; README §6 corrected to ADR-010 | DONE |
| L8 | Verify: tsc, lint, tests, real-browser screenshots desktop + mobile, no horizontal overflow, no console errors | DONE |
