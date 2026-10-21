import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { FieldError } from "../ui/kit";

interface SecureCredentialCardProps {
  /** Which secret Orbit asked for. Only that one field is shown. */
  kind: string;
  onSubmit: (data: { password?: string; api_key?: string }) => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
}

const LABELS: Record<string, { title: string; field: string; placeholder: string; empty: string; max: number }> = {
  database_password: { title: "Database password", field: "password", placeholder: "Enter the database user's password", empty: "Enter the database password.", max: 255 },
  api_key: { title: "Provider API key", field: "api_key", placeholder: "Paste the API key", empty: "Paste the API key.", max: 500 },
};

/**
 * Masked capture for a secret Orbit needs. The value goes straight to the server's
 * encrypted vault for this task: it is not added to the conversation, not sent to the
 * language model, not spoken, and not shown again.
 */
export const SecureCredentialCard: React.FC<SecureCredentialCardProps> = ({ kind, onSubmit, onCancel, disabled = false }) => {
  const meta = LABELS[kind] || LABELS.database_password;
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [kind]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // Checked here only: the secret itself is never logged or sent anywhere but the vault.
    const problem = !value ? meta.empty : value.length > meta.max ? `${meta.title} must be ${meta.max} characters or fewer.` : null;
    setError(problem);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    const secret = value;
    setValue(""); // do not keep the secret in component state longer than needed
    try {
      await onSubmit(meta.field === "api_key" ? { api_key: secret } : { password: secret });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-2xl space-y-2" aria-label={`Secure ${meta.title} entry`}>
      <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
        <Lock className="w-3.5 h-3.5" />
        <span>{meta.title}</span>
        <span className="ml-auto text-[10px] font-normal text-emerald-400/80">encrypted, never sent to the AI model</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type={visible ? "text" : "password"}
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          placeholder={meta.placeholder}
          disabled={disabled || submitting}
          id="orbit-secret"
          aria-label={meta.title}
          aria-invalid={!!error}
          aria-describedby={error ? "orbit-secret-error" : undefined}
          className={`flex-1 min-w-0 bg-slate-900 border rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none ${error ? "border-rose-400/80 focus:border-rose-400" : "border-slate-700 focus:border-emerald-400"}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide value" : "Show value"}
          className="p-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-white"
        >
          {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <FieldError id="orbit-secret" message={error} tone="dark" className="-mt-1" />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || submitting}
          className="flex-1 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-semibold"
        >
          {submitting ? "Sending securely…" : "Send securely"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default SecureCredentialCard;
