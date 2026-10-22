import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { AuthShell } from "../components/ui/AuthShell";
import { FieldError, FormAlert } from "../components/ui/kit";
import { useAuth } from "../context/AuthContext";
import { usePlatform } from "../context/PlatformContext";
import { api } from "../services/api";
import { ariaFor, clearError, focusFirstError, invalid, rules, serverFieldErrors, validate, type FieldErrors } from "../lib/validation";

/** The password minimum is set in the admin panel; the server applies the same rule. */
const schemaFor = (minPassword: number) => ({
  name: [rules.required("Name"), rules.maxLength(255, "Name")],
  email: [rules.required("Email"), rules.email(), rules.maxLength(255, "Email")],
  password: [rules.required("Password"), rules.minLength(minPassword, "Password"), rules.maxLength(255, "Password")],
  password_confirmation: [rules.required("Confirm password", "Repeat your password to confirm it."), rules.sameAs("password", "The passwords do not match.")],
});
const FIELD_ID: Record<string, string> = { name: "reg-name", email: "reg-email", password: "reg-password", password_confirmation: "reg-confirm" };

export const RegisterPage: React.FC = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { config } = usePlatform();
  const minPassword = config.platform.password_min_length;

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const found = validate({ name, email, password, password_confirmation: passwordConfirmation }, schemaFor(minPassword));
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, (f) => FIELD_ID[f]);
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await api.register({
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirmation: passwordConfirmation,
      });

      if (res?.token && res?.user) {
        login(res.token, res.user);
        navigate("/dashboard");
      } else {
        setError("Invalid response received from server.");
      }
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      if (Object.keys(fields).length) {
        setErrors(fields);
        focusFirstError(fields, (f) => FIELD_ID[f] ?? f);
      } else {
        setError(err?.message || "Could not create your workspace. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const strength = password.length === 0 ? 0 : password.length < minPassword ? 1 : /[A-Z]/.test(password) && /\d/.test(password) && password.length >= Math.max(12, minPassword) ? 3 : 2;

  if (!config.platform.registration_open) {
    return (
      <AuthShell
        title="Sign-ups are paused"
        subtitle={config.platform.registration_closed_message}
      >
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-[14px] leading-relaxed text-slate-600">
          New workspaces cannot be created right now.
          {config.platform.support_email && (
            <> Questions? Write to <a href={`mailto:${config.platform.support_email}`} className="font-semibold text-indigo-600 hover:text-indigo-700">{config.platform.support_email}</a>.</>
          )}
        </div>
        <Link to="/login" className="da-btn da-btn-primary mt-5 w-full py-3 text-[14px]">Sign in <ArrowRight className="h-4 w-4" /></Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Free and private to you. Connect a database in the next step."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">Sign in</Link></>}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormAlert message={error} onClose={() => setError(null)} />
        <div>
          <label className="da-label" htmlFor="reg-name">Name</label>
          <div className="relative">
            <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="reg-name" type="text" autoComplete="name" value={name}
              onChange={(e) => { setName(e.target.value); setErrors((x) => clearError(x, "name")); }}
              placeholder="Your name" className={`da-input py-3 pl-10${invalid(errors.name)}`} {...ariaFor("reg-name", errors.name)} />
          </div>
          <FieldError id="reg-name" message={errors.name} />
        </div>
        <div>
          <label className="da-label" htmlFor="reg-email">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="reg-email" type="email" autoComplete="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => clearError(x, "email")); }}
              placeholder="you@company.com" className={`da-input py-3 pl-10${invalid(errors.email)}`} {...ariaFor("reg-email", errors.email)} />
          </div>
          <FieldError id="reg-email" message={errors.email} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="da-label" htmlFor="reg-password">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="reg-password" type="password" autoComplete="new-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((x) => clearError(clearError(x, "password"), "password_confirmation")); }}
                placeholder={`${minPassword}+ characters`} className={`da-input py-3 pl-10${invalid(errors.password)}`} {...ariaFor("reg-password", errors.password)} />
            </div>
            <FieldError id="reg-password" message={errors.password} />
          </div>
          <div>
            <label className="da-label" htmlFor="reg-confirm">Confirm</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="reg-confirm" type="password" autoComplete="new-password" value={passwordConfirmation}
                onChange={(e) => { setPasswordConfirmation(e.target.value); setErrors((x) => clearError(x, "password_confirmation")); }}
                placeholder="Repeat it" className={`da-input py-3 pl-10${invalid(errors.password_confirmation)}`} {...ariaFor("reg-confirm", errors.password_confirmation)} />
            </div>
            <FieldError id="reg-confirm" message={errors.password_confirmation} />
          </div>
        </div>
        <div className="flex items-center gap-2" aria-hidden>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${strength >= i ? (strength === 1 ? "bg-rose-400" : strength === 2 ? "bg-amber-400" : "bg-emerald-500") : "bg-slate-200"}`} />
          ))}
          <span className="w-16 text-right text-[11.5px] text-slate-500">{["", "Too short", "Good", "Strong"][strength]}</span>
        </div>
        <button type="submit" disabled={isSubmitting} className="da-btn da-btn-primary w-full py-3 text-[14px]">
          {isSubmitting ? "Creating workspace…" : <>Create workspace <ArrowRight className="h-4 w-4" /></>}
        </button>
        <p className="flex items-center justify-center gap-1.5 pt-1 text-[12.5px] text-slate-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> No credit card, no paid API needed.
        </p>
      </form>
    </AuthShell>
  );
};
