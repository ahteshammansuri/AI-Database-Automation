/**
 * Semantic UI target registry for Orbit.
 *
 * Components register real elements under stable app-owned keys
 * (e.g. "nav:/connections", "connections.add", "connections.form.password").
 * Orbit resolves a key to the element's *current* bounds only to animate toward it;
 * the operation itself is always a typed action handler, never a pixel position.
 */

type Listener = () => void;

class OrbitTargetRegistry {
  private targets = new Map<string, HTMLElement>();
  private listeners = new Set<Listener>();

  register(key: string, el: HTMLElement | null): void {
    if (el) {
      this.targets.set(key, el);
      el.setAttribute("data-orbit-target", key);
    } else {
      this.targets.delete(key);
    }
    this.listeners.forEach((l) => l());
  }

  unregister(key: string, el?: HTMLElement | null): void {
    if (!el || this.targets.get(key) === el) {
      this.targets.delete(key);
      this.listeners.forEach((l) => l());
    }
  }

  get(key: string): HTMLElement | null {
    const el = this.targets.get(key);
    if (el && !el.isConnected) {
      this.targets.delete(key);
      return null;
    }
    return el ?? null;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  rect(key: string): DOMRect | null {
    return this.get(key)?.getBoundingClientRect() ?? null;
  }

  /** Resolve once the key is registered (e.g. after a route change mounts the page). */
  waitFor(key: string, timeoutMs = 2000): Promise<HTMLElement | null> {
    const found = this.get(key);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        resolve(null);
      }, timeoutMs);
      const check = () => {
        const el = this.get(key);
        if (el) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve(el);
        }
      };
      this.listeners.add(check);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  keys(): string[] {
    return Array.from(this.targets.keys());
  }
}

export const orbitTargets = new OrbitTargetRegistry();
