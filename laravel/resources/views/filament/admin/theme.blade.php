{{-- Admin panel theme: matches the customer portal (ink navigation, soft canvas, rounded cards, indigo/violet). --}}
<style>
    :root { --da-ink: #060914; --da-canvas: #F7F8FC; --da-line: #E8EAF3; }
    .fi-body { background: var(--da-canvas); }
    .dark .fi-body { background: #0B1022; }

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

    /* Sign-in: the portal's aurora on ink */
    .fi-simple-layout { background:
            radial-gradient(55% 45% at 12% 8%, rgba(99,102,241,.38), transparent 60%),
            radial-gradient(50% 45% at 92% 18%, rgba(139,92,246,.32), transparent 60%),
            radial-gradient(45% 40% at 50% 105%, rgba(34,211,238,.2), transparent 60%),
            var(--da-ink) !important; }
    .fi-simple-main { border-radius: 1.75rem !important; box-shadow: 0 40px 90px -40px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.06) !important; }
</style>
