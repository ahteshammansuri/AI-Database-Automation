/**
 * What the web Orbit visibly shows right now (the state it is drawn in, whether it is in its corner or flying)
 * and the element it is drawn in. FloatingMascot writes it; Orbit Remote reads it to mirror Orbit on a phone.
 */
export interface OrbitPresenceState {
  state: string;
  emotion: string | null;
  docked: boolean;
  moving: boolean;
  /** The floating Orbit's box (for its on-screen position). */
  el: HTMLElement | null;
}

type Listener = (p: OrbitPresenceState) => void;

class OrbitPresence {
  private p: OrbitPresenceState = { state: "idle", emotion: null, docked: true, moving: false, el: null };
  private listeners = new Set<Listener>();

  get(): OrbitPresenceState {
    return this.p;
  }

  set(patch: Partial<OrbitPresenceState>): void {
    const next = { ...this.p, ...patch };
    if (next.state === this.p.state && next.emotion === this.p.emotion && next.docked === this.p.docked
      && next.moving === this.p.moving && next.el === this.p.el) return;
    this.p = next;
    this.listeners.forEach((l) => {
      try {
        l(next);
      } catch {
        // a listener error never breaks Orbit
      }
    });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const orbitPresence = new OrbitPresence();
