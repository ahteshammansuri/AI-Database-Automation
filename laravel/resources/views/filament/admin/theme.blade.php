{{-- Admin panel theme: matches the customer portal (ink navigation, soft canvas, rounded cards, indigo/violet). --}}
<style>
    :root { --da-ink: #060914; --da-canvas: #F6F7FB; --da-line: #E6E9F2; --da-card: #FFFFFF;
            --da-d-canvas: #070B17; --da-d-card: #0D1326; --da-d-raise: #111A33; --da-d-line: rgba(148,163,184,.12); }
    .fi-body { background: var(--da-canvas); }
    .dark .fi-body { background:
            radial-gradient(70% 45% at 85% -10%, rgba(99,102,241,.12), transparent 60%),
            radial-gradient(50% 35% at 0% 100%, rgba(139,92,246,.08), transparent 60%),
            var(--da-d-canvas); background-attachment: fixed; }

    /* Brand */
    .da-brand { display: flex; align-items: center; gap: .65rem; }
    .da-brand-mark { display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border-radius: .75rem; color: #fff;
        background: linear-gradient(135deg, #6366F1, #8B5CF6 55%, #22D3EE); box-shadow: 0 10px 24px -10px rgba(99,102,241,.9); }
    .da-brand-mark svg { width: 1.05rem; height: 1.05rem; }
    .da-brand-text { display: flex; align-items: center; gap: .45rem; }
    .da-brand-name { font-weight: 800; letter-spacing: -.02em; font-size: 1.02rem; color: #0F172A; }
    .fi-sidebar .da-brand-name, .dark .da-brand-name, .fi-simple-layout .da-brand-name { color: #fff; }
    .fi-topbar .da-brand-tag { color: #4F46E5; background: #EEF2FF; border-color: #C7D2FE; }
    .dark .fi-topbar .da-brand-tag { color: #C7D2FE; background: rgba(99,102,241,.18); border-color: rgba(129,140,248,.35); }
    .da-brand-tag { font-size: .62rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; padding: .15rem .45rem;
        border-radius: 999px; color: #C7D2FE; background: rgba(99,102,241,.18); border: 1px solid rgba(129,140,248,.35); }

    /* Sidebar: the portal's ink navigation */
    .fi-sidebar { background:
            radial-gradient(120% 50% at 0% 0%, rgba(99,102,241,.24), transparent 60%),
            radial-gradient(90% 40% at 100% 100%, rgba(139,92,246,.18), transparent 60%),
            var(--da-ink) !important;
        border-inline-end: 1px solid rgba(255,255,255,.06); }
    .fi-sidebar .fi-sidebar-header { background: transparent !important; box-shadow: none !important; border-bottom: 1px solid rgba(255,255,255,.06); }
    .fi-sidebar .fi-sidebar-group-label { color: #64748B !important; text-transform: uppercase; letter-spacing: .14em; font-size: .68rem; font-weight: 700; }
    .fi-sidebar .fi-sidebar-item-label { color: #CBD5E1 !important; font-weight: 500; }
    .fi-sidebar .fi-sidebar-item-icon { color: #64748B !important; }
    .fi-sidebar .fi-sidebar-item-btn { border-radius: .8rem; transition: background .15s ease; }
    .fi-sidebar .fi-sidebar-item-btn:hover { background: rgba(255,255,255,.06) !important; }
    .fi-sidebar .fi-sidebar-item.fi-active > .fi-sidebar-item-btn { background: linear-gradient(90deg, rgba(99,102,241,.34), rgba(139,92,246,.16)) !important;
        box-shadow: inset 0 0 0 1px rgba(129,140,248,.35); }
    .fi-sidebar .fi-sidebar-item.fi-active .fi-sidebar-item-label { color: #fff !important; font-weight: 600; }
    .fi-sidebar .fi-sidebar-item.fi-active .fi-sidebar-item-icon { color: #A5B4FC !important; }
    .fi-sidebar .fi-sidebar-group-btn button, .fi-sidebar .fi-sidebar-group-collapse-btn { color: #64748B !important; }
    .fi-sidebar .fi-sidebar-item-badge-ctn .fi-badge { box-shadow: none; }

    /* Topbar */
    .fi-topbar { background: rgba(255,255,255,.82) !important; backdrop-filter: blur(14px); box-shadow: none !important; border-bottom: 1px solid var(--da-line); }
    .dark .fi-topbar { background: rgba(11,16,34,.85) !important; border-bottom-color: rgba(255,255,255,.06); }

    /* Cards */
    .fi-section:not(.fi-section-not-contained), .fi-ta-ctn, .fi-wi-stats-overview-stat, .fi-wi-chart .fi-section {
        border-radius: 1.25rem !important;
        box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 12px 28px -18px rgba(15,23,42,.22) !important; }
    .fi-header-heading { letter-spacing: -.035em; font-weight: 800; }
    .fi-wi-stats-overview-stat-value { letter-spacing: -.03em; }

    /* Light: hairline edges instead of heavy shadows, calm table header, clear hover */
    .fi-section:not(.fi-section-not-contained), .fi-ta-ctn, .fi-wi-stats-overview-stat {
        box-shadow: 0 0 0 1px var(--da-line), 0 14px 30px -24px rgba(15,23,42,.28) !important; }
    .fi-ta-header-cell { background: #F8F9FD; }
    .fi-ta-row { transition: background .12s ease; }
    .fi-ta-row:hover { background: #F5F6FF; }
    .fi-modal-window { border-radius: 1.4rem !important; }

    /* Dark: raised surfaces with visible edges, readable tables and inputs */
    .dark .fi-section:not(.fi-section-not-contained), .dark .fi-ta-ctn, .dark .fi-wi-stats-overview-stat,
    .dark .fi-wi-chart .fi-section {
        background: var(--da-d-card) !important;
        box-shadow: 0 0 0 1px var(--da-d-line), 0 24px 48px -30px rgba(0,0,0,.85) !important; }
    .dark .fi-section-header { border-color: var(--da-d-line) !important; }
    .dark .fi-ta-header, .dark .fi-ta-header-cell { background: rgba(255,255,255,.02); }
    .dark .fi-ta-header-cell { color: #94A3B8; }
    .dark .fi-ta-row { border-color: var(--da-d-line) !important; }
    .dark .fi-ta-row:hover { background: rgba(99,102,241,.07); }
    .dark .fi-ta-cell { color: #CBD5E1; }
    .dark .fi-input-wrp { background: #0A1020 !important; box-shadow: 0 0 0 1px rgba(148,163,184,.18) !important; }
    .dark .fi-input-wrp:focus-within { box-shadow: 0 0 0 2px rgba(129,140,248,.55) !important; }
    .dark .fi-modal-window, .dark .fi-dropdown-panel { background: var(--da-d-raise) !important;
        box-shadow: 0 0 0 1px rgba(148,163,184,.16), 0 40px 80px -30px rgba(0,0,0,.9) !important; }
    .dark .fi-pagination { color: #94A3B8; }
    .dark .fi-header-heading { color: #F8FAFC; }
    .dark .fi-header-subheading { color: #94A3B8; }

    /* Quiet scrollbars (the sidebar showed a bright track on dark) */
    .fi-sidebar-nav, .fi-sidebar { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.28) transparent; }
    .fi-sidebar-nav::-webkit-scrollbar, .fi-sidebar ::-webkit-scrollbar { width: 8px; }
    .fi-sidebar-nav::-webkit-scrollbar-thumb, .fi-sidebar ::-webkit-scrollbar-thumb { background: rgba(148,163,184,.25); border-radius: 999px; }
    .fi-sidebar-nav::-webkit-scrollbar-track, .fi-sidebar ::-webkit-scrollbar-track { background: transparent; }
    .dark { color-scheme: dark; }

    /* Sign-in: the portal's aurora on ink */
    .fi-simple-layout { background:
            radial-gradient(55% 45% at 12% 8%, rgba(99,102,241,.38), transparent 60%),
            radial-gradient(50% 45% at 92% 18%, rgba(139,92,246,.32), transparent 60%),
            radial-gradient(45% 40% at 50% 105%, rgba(34,211,238,.2), transparent 60%),
            var(--da-ink) !important; }
    .fi-simple-main { border-radius: 1.75rem !important; box-shadow: 0 40px 90px -40px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.06) !important; }

    /* Skeletons: widgets that load after the page show their own shape (views in filament/admin/skeletons),
       with the portal's calm sweep. Tokens switch with the panel's dark mode. */
    :root { --skel-base: #E8EBF3; --skel-strong: #DFE3EC; --skel-accent: #E0E7FF; --skel-stroke: #C7D2FE;
            --skel-shine: rgba(255,255,255,.7); --skel-line: #EEF0F6; }
    .dark { --skel-base: rgba(148,163,184,.11); --skel-strong: rgba(148,163,184,.17); --skel-accent: rgba(129,140,248,.2);
            --skel-stroke: rgba(129,140,248,.45); --skel-shine: rgba(199,210,254,.1); --skel-line: rgba(148,163,184,.1); }
    .da-skel { position: relative; display: block; overflow: hidden; border-radius: .45rem; background: var(--skel-base); }
    .da-skel-strong { background: var(--skel-strong); }
    .da-skel-accent { background: var(--skel-accent); }
    .da-skel::after, .fi-loading-section::after, .fi-ta-table-loading-ctn::after {
        content: ""; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(100deg, transparent 20%, var(--skel-shine) 50%, transparent 80%);
        animation: da-skel-sweep 1.9s cubic-bezier(.4,0,.2,1) infinite; animation-delay: var(--skel-delay, 0s); }
    @keyframes da-skel-sweep { 0% { transform: translateX(-100%); } 65%, 100% { transform: translateX(100%); } }
    @keyframes da-skel-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes da-skel-pulse { 50% { opacity: .55; } }
    .da-adm-skel { animation: da-skel-in .35s ease-out both; }

    /* Stats overview (one column below lg, as Filament lays out columns(n)) */
    .da-adm-stats { display: grid; gap: 1.5rem; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 1024px) { .da-adm-stats { grid-template-columns: repeat(var(--da-cols, 4), minmax(0, 1fr)); } }
    .da-adm-stat { display: grid; align-content: start; gap: .8rem; min-height: 8.5rem; overflow: hidden; }
    .da-adm-stat-chart { position: absolute; inset-inline: 0; bottom: 0; height: 1.5rem; border-radius: 0; opacity: .8; }

    /* Chart */
    .da-adm-chart { position: relative; display: flex; align-items: flex-end; }
    .da-adm-chart-grid { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
    .da-adm-chart-grid > span { display: block; height: 1px; background: var(--skel-line); }
    .da-adm-bars { position: relative; display: flex; align-items: flex-end; gap: .6rem; width: 100%; height: 100%; padding-inline: .25rem; }
    .da-adm-bars > .da-skel { flex: 1; border-radius: .4rem .4rem .15rem .15rem; }
    .da-adm-line { position: relative; width: 100%; height: 100%; overflow: visible; animation: da-skel-pulse 1.9s ease-in-out infinite; }
    .da-adm-line-area { fill: var(--skel-accent); opacity: .6; }
    .da-adm-line-stroke { fill: none; stroke: var(--skel-stroke); stroke-width: 3; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .da-adm-axis { display: flex; justify-content: space-between; margin-top: .9rem; }

    /* Table */
    .da-adm-table { overflow: hidden; flex-direction: column; } /* .fi-ta-ctn is a row flexbox */
    .da-adm-table-heading { padding: 1.05rem 1.5rem; }
    .da-adm-table-row { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr); align-items: center;
        gap: 1rem; padding: .9rem 1.5rem; border-top: 1px solid var(--skel-line); }
    .da-adm-table-head { padding-block: .8rem; background: #F8F9FD; }
    .dark .da-adm-table-head { background: rgba(255,255,255,.02); }
    .da-adm-cell-stack { display: grid; gap: .45rem; }

    /* Anything else that loads lazily (Filament's generic placeholder) or a deferred table: lines, not a pulse or spinner */
    .fi-loading-section { position: relative; overflow: hidden; animation: none !important; }
    .fi-loading-section::before { content: ""; position: absolute; inset: 1.5rem;
        background: linear-gradient(var(--skel-strong), var(--skel-strong)) 0 0 / 38% .9rem no-repeat,
                    linear-gradient(var(--skel-base), var(--skel-base)) 0 1.75rem / 72% .65rem no-repeat,
                    linear-gradient(var(--skel-base), var(--skel-base)) 0 2.9rem / 56% .65rem no-repeat; }
    .fi-ta-table-loading-ctn { position: relative; overflow: hidden; min-height: 16rem; }
    .fi-ta-table-loading-ctn > :not(.fi-sr-only) { visibility: hidden; }
    .fi-ta-table-loading-ctn::before { content: ""; position: absolute; inset: 1.25rem 1.5rem;
        background: repeating-linear-gradient(to bottom, var(--skel-base) 0 .7rem, transparent .7rem 2.9rem); }

    @media (prefers-reduced-motion: reduce) {
        .da-skel::after, .fi-loading-section::after, .fi-ta-table-loading-ctn::after { animation: none; opacity: 0; }
        .da-adm-skel, .da-adm-line { animation: none; }
    }
</style>
