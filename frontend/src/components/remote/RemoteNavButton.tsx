import React from "react";
import { Smartphone } from "lucide-react";
import { useOrbitRemote } from "../../context/OrbitRemoteContext";

/** Navbar shortcut to Orbit Remote; a green dot while a phone is connected to this tab. */
export const RemoteNavButton: React.FC = () => {
  const { phase, session, openModal } = useOrbitRemote();
  const connected = phase === "connected";
  const label = connected ? `Phone connected: ${session?.device_label || "your phone"}` : "Use Orbit from your phone";
  return (
    <button type="button" onClick={openModal} className="da-icon-btn relative" title={label} aria-label={label}>
      <Smartphone className={`h-4 w-4 ${connected ? "text-emerald-600" : ""}`} />
      {connected && (
        <span className="absolute right-1 top-1 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
      )}
    </button>
  );
};
