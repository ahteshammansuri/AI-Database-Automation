import Echo from "laravel-echo";
import Pusher from "pusher-js";

(window as any).Pusher = Pusher;

let echoInstance: Echo<any> | null = null;

/**
 * Reverb connection options. An https page cannot open plain ws:// sockets, so when the page is https but Reverb
 * itself is not (local development with `npm run dev:https`), the socket goes to the page's own origin and Vite
 * forwards /app to Reverb. In production, set VITE_REVERB_SCHEME=https and put Reverb behind TLS.
 */
export function reverbOptions(authEndpoint: string, bearer: string) {
  const scheme = import.meta.env.VITE_REVERB_SCHEME || "http";
  const sameOrigin = window.location.protocol === "https:" && scheme !== "https";
  const port = sameOrigin ? Number(window.location.port || 443) : Number(import.meta.env.VITE_REVERB_PORT || 8080);
  return {
    broadcaster: "reverb" as const,
    key: import.meta.env.VITE_REVERB_APP_KEY || "coj25aqlrrupjdrpaeqz",
    wsHost: sameOrigin ? window.location.hostname : import.meta.env.VITE_REVERB_HOST || window.location.hostname,
    wsPort: port,
    wssPort: port,
    forceTLS: sameOrigin || scheme === "https",
    enabledTransports: ["ws", "wss"] as any,
    authEndpoint,
    auth: {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
    },
  };
}

export function getEcho(): Echo<any> | null {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    if (echoInstance) {
      echoInstance.disconnect();
      echoInstance = null;
    }
    return null;
  }

  if (echoInstance) {
    return echoInstance;
  }

  try {
    echoInstance = new Echo(reverbOptions("/api/broadcasting/auth", token));
    return echoInstance;
  } catch (err) {
    console.warn("Failed to initialize Laravel Echo Reverb client:", err);
    return null;
  }
}

/** A separate connection for a phone paired with Orbit Remote (its device token only opens its own channel). */
export function createDeviceEcho(deviceToken: string): Echo<any> | null {
  try {
    return new Echo(reverbOptions("/api/orbit-remote/device/broadcasting/auth", deviceToken));
  } catch (err) {
    console.warn("Orbit Remote: live connection unavailable:", err);
    return null;
  }
}

export function disconnectEcho(): void {
  if (echoInstance) {
    try {
      echoInstance.disconnect();
    } catch {
      // ignore
    }
    echoInstance = null;
  }
}
