import React from "react";
import { Mic } from "lucide-react";
import { OrbitRig } from "../agent/orbit/OrbitRig";

/** A phone showing Orbit's face, as Orbit Remote looks on the phone (used on the dashboard and in the pairing window). */
export const PhoneOrbitMock: React.FC<{ state?: string; width?: number; caption?: string; className?: string }> = ({
  state = "idle", width = 168, caption = "Hold to talk", className = "",
}) => {
  const face = Math.round(width * 0.8);
  return (
    <div
      className={`relative shrink-0 rounded-[2.1rem] border-[5px] border-slate-900 bg-ink p-3 shadow-[0_30px_60px_-30px_rgba(15,23,42,0.9),inset_0_0_0_1px_rgba(255,255,255,0.06)] ${className}`}
      style={{ width }}
      aria-hidden
    >
      <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-800" />
      <div className="relative overflow-hidden rounded-[1.4rem] bg-[radial-gradient(120%_80%_at_50%_0%,rgba(99,102,241,0.35),transparent_60%),radial-gradient(90%_60%_at_50%_100%,rgba(34,211,238,0.18),transparent_70%)] px-2 pb-3 pt-4">
        <div className="mx-auto" style={{ width: face }}>
          <OrbitRig state={state} width={face} framing="head" followPointer={false} label="Orbit on your phone" />
        </div>
        <div className="mt-2 flex justify-center">
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-cyan-200">
            <Mic className="h-3 w-3" /> {caption}
          </span>
        </div>
      </div>
    </div>
  );
};
