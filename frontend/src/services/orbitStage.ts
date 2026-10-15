/**
 * Typed body events for Orbit's character. Emitted only by real runtime activity
 * (a UI action about to run, a tool running, speech playing) so the character never
 * performs work that is not happening.
 */
export type OrbitGesture = "tap" | "type" | "point" | "inspect" | "wave";

export type OrbitBodyEvent =
  | { type: "travel"; target: string }
  | { type: "gesture"; gesture: OrbitGesture; target?: string }
  | { type: "return" }
  /** Short caption bubble next to Orbit (show_me guidance). */
  | { type: "caption"; text: string }
  /** Orbit is waiting for the user to type a secret into a real form field. */
  | { type: "secret_wait"; target: string; taskId: number; surface: string; field: string; label: string }
  | { type: "secret_done" };

type Listener = (e: OrbitBodyEvent) => void;

class OrbitStage {
  private listeners = new Set<Listener>();

  emit(e: OrbitBodyEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(e);
      } catch (err) {
        console.error("[OrbitStage] listener error", err);
      }
    });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const orbitStage = new OrbitStage();
