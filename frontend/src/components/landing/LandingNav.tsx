import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Database, LayoutDashboard, Menu, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { usePlatform } from "../../context/PlatformContext";
import { EASE } from "./motion";
import { NAV_LINKS } from "./navLinks";
import { AnnouncementBar } from "../common/AnnouncementBar";


export const Logo: React.FC<{ light?: boolean }> = ({ light = true }) => {
  const { brand } = usePlatform();
  return (
  <Link to="/" className="flex items-center gap-2.5 group" aria-label={`${brand} home`}>
    <span className="relative grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)] transition-transform duration-500 group-hover:rotate-[8deg] group-hover:scale-105">
      <Database className="w-[18px] h-[18px] text-white" />
    </span>
    <span className={`text-[17px] font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`}>{brand}</span>
  </Link>
  );
};

/** Transparent over the hero, frosted glass once the page scrolls; thin progress line on top. */
export const LandingNav: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // Light or dark glass, matching the section currently under the bar (sections carry data-nav-theme).
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 24);
    const under = [...document.querySelectorAll<HTMLElement>("[data-nav-theme]")].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top <= 32 && r.bottom > 32;
    });
    setTheme(under?.dataset.navTheme === "light" ? "light" : "dark");
  });
  const light = theme === "light" && (scrolled || open);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <AnnouncementBar />
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="absolute inset-x-0 top-0 h-[2px] origin-left bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400"
      />
      <div
        className={`transition-[background-color,border-color,backdrop-filter] duration-500 border-b ${
          !(scrolled || open)
            ? "bg-transparent border-transparent"
            : light
              ? "bg-white/80 backdrop-blur-xl border-slate-200/70 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.25)]"
              : "bg-[#060914]/75 backdrop-blur-xl border-white/10"
        }`}
      >
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo light={!light} />
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={`relative px-3.5 py-2 text-[14px] font-medium transition-colors rounded-full ${
                  light ? "text-slate-600 hover:text-slate-950 hover:bg-slate-900/[0.04]" : "text-slate-300 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-2">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${light ? "bg-slate-950 text-white hover:bg-indigo-600" : "bg-white text-slate-950 hover:bg-indigo-50"}`}
              >
                <LayoutDashboard className="w-4 h-4" /> Open dashboard
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <>
                <Link to="/login" className={`px-3.5 py-2 text-[14px] font-medium transition-colors ${light ? "text-slate-600 hover:text-slate-950" : "text-slate-300 hover:text-white"}`}>
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className={`group inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${light ? "bg-slate-950 text-white hover:bg-indigo-600" : "bg-white text-slate-950 hover:bg-indigo-50"}`}
                >
                  Get started
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`md:hidden p-2 -mr-2 rounded-lg ${light ? "text-slate-700 hover:bg-slate-100" : "text-slate-200 hover:bg-white/10"}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="md:hidden overflow-hidden"
            >
              <div className="px-4 pb-5 pt-1 flex flex-col">
                {NAV_LINKS.map((l) => (
                  <a key={l.href} href={l.href} onClick={() => setOpen(false)} className={`py-3 text-[15px] font-medium border-b ${light ? "text-slate-700 border-slate-100" : "text-slate-200 border-white/5"}`}>
                    {l.label}
                  </a>
                ))}
                <div className="grid grid-cols-2 gap-2 pt-4">
                  {isAuthenticated ? (
                    <Link to="/dashboard" className={`col-span-2 text-center rounded-full py-2.5 text-[14px] font-semibold ${light ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}>
                      Open dashboard
                    </Link>
                  ) : (
                    <>
                      <Link to="/login" className={`text-center rounded-full border py-2.5 text-[14px] font-semibold ${light ? "border-slate-200 text-slate-800" : "border-white/15 text-white"}`}>
                        Sign in
                      </Link>
                      <Link to="/register" className={`text-center rounded-full py-2.5 text-[14px] font-semibold ${light ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}>
                        Get started
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
};
