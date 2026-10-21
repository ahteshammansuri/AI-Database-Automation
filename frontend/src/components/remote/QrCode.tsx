import React, { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Database } from "lucide-react";

/**
 * A QR code drawn as one crisp SVG path, generated in the browser (the pairing code never leaves this page except
 * to the phone that scans it). Error correction "Q" leaves room for the DataAuto mark in the middle.
 */
export const QrCode: React.FC<{ value: string; size?: number; className?: string; label?: string }> = ({ value, size = 232, className = "", label }) => {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "Q");
    qr.addData(value, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);

  const quiet = 2;
  const logo = Math.round(size * 0.2);
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
        width={size}
        height={size}
        role="img"
        aria-label={label ?? "QR code"}
        shapeRendering="crispEdges"
        className="block rounded-2xl bg-white"
      >
        <path d={path} fill="#0B1020" />
      </svg>
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl bg-white p-1 shadow-sm"
        style={{ width: logo, height: logo }}
      >
        <span className="grid h-full w-full place-items-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white">
          <Database className="h-1/2 w-1/2" strokeWidth={2.4} />
        </span>
      </span>
    </div>
  );
};
