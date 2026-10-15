/**
 * PageStateService - Structured Page State Snapshot Service
 * Exposes live application context (route, mounted forms, field values with secrets masked,
 * validation state, active entities, modals) to the AI Agent for intelligent multi-turn navigation.
 */

export interface FormFieldState {
  name: string;
  type?: string;
  label?: string;
  value: any;
  isMasked?: boolean;
  /** True while the value is the form's untouched default (not something the user or Orbit entered). */
  isDefault?: boolean;
  isValid?: boolean;
  error?: string;
}

export interface FormSnapshot {
  formId: string;
  name: string;
  isDirty: boolean;
  isValid: boolean;
  fields: Record<string, FormFieldState>;
}

export interface ActiveEntity {
  type: "connection" | "automation" | "execution" | "document" | "table" | string;
  id: string | number;
  name?: string;
}

export interface PageSnapshot {
  currentPath: string;
  pageTitle: string;
  activeEntity?: ActiveEntity | null;
  mountedForms: Record<string, FormSnapshot>;
  activeModal?: string | null;
  filters?: Record<string, any>;
  timestamp: string;
}

type StateListener = (snapshot: PageSnapshot) => void;

class PageStateService {
  private currentPath = "/";
  private pageTitle = "Portal";
  private activeEntity: ActiveEntity | null = null;
  private mountedForms: Map<string, FormSnapshot> = new Map();
  private activeModal: string | null = null;
  private filters: Record<string, any> = {};
  private listeners: Set<StateListener> = new Set();

  public setRoute(path: string, title?: string): void {
    this.currentPath = path;
    if (title) this.pageTitle = title;
    this.notify();
  }

  public setActiveModal(modalName: string | null): void {
    this.activeModal = modalName;
    this.notify();
  }

  public setActiveEntity(type: string, id: string | number, name?: string): void {
    this.activeEntity = { type, id, name };
    this.notify();
  }

  public clearActiveEntity(): void {
    this.activeEntity = null;
    this.notify();
  }

  public registerForm(formId: string, name: string): void {
    if (!this.mountedForms.has(formId)) {
      this.mountedForms.set(formId, {
        formId,
        name,
        isDirty: false,
        isValid: true,
        fields: {},
      });
      this.notify();
    }
  }

  public unregisterForm(formId: string): void {
    if (this.mountedForms.has(formId)) {
      this.mountedForms.delete(formId);
      this.notify();
    }
  }

  public updateFormField(
    formId: string,
    fieldName: string,
    value: any,
    options?: { isSecret?: boolean; isDefault?: boolean; error?: string; label?: string; type?: string }
  ): void {
    if (!this.mountedForms.has(formId)) {
      this.registerForm(formId, formId);
    }

    const form = this.mountedForms.get(formId)!;
    const isSecret = options?.isSecret || /password|secret|key|token/i.test(fieldName);

    let displayVal = value;
    if (isSecret && value) {
      displayVal = "••••••••";
    }

    form.fields[fieldName] = {
      name: fieldName,
      type: options?.type || "text",
      label: options?.label || fieldName,
      value: displayVal,
      isMasked: isSecret,
      isDefault: Boolean(options?.isDefault),
      isValid: !options?.error,
      error: options?.error,
    };

    form.isDirty = true;
    form.isValid = !Object.values(form.fields).some((f) => !!f.error);

    this.notify();
  }

  public setFilters(filters: Record<string, any>): void {
    this.filters = { ...this.filters, ...filters };
    this.notify();
  }

  public getSnapshot(): PageSnapshot {
    const formsObj: Record<string, FormSnapshot> = {};
    this.mountedForms.forEach((v, k) => {
      formsObj[k] = { ...v, fields: { ...v.fields } };
    });

    return {
      currentPath: this.currentPath,
      pageTitle: this.pageTitle,
      activeEntity: this.activeEntity ? { ...this.activeEntity } : null,
      mountedForms: formsObj,
      activeModal: this.activeModal,
      filters: { ...this.filters },
      timestamp: new Date().toISOString(),
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch (e) {
        console.error("[PageStateService] Listener error:", e);
      }
    });
  }
}

export const pageStateService = new PageStateService();
