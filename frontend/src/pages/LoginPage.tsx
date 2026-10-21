import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Lock, Mail, ShieldCheck } from "lucide-react";
import { AuthShell } from "../components/ui/AuthShell";
import { FieldError, FormAlert } from "../components/ui/kit";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { ariaFor, clearError, focusFirstError, invalid, rules, serverFieldErrors, validate, type FieldErrors } from "../lib/validation";

const SCHEMA = {
  email: [rules.required("Email"), rules.email()],
  password: [rules.required("Password")],
};
const FIELD_ID: Record<string, string> = { email: "login-email", password: "login-password" };

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const found = validate({ email, password }, SCHEMA);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, (f) => FIELD_ID[f]);
      return;
    }
    setIsSubmitting(true);

    try {
      const res = await api.login({ email: email.trim(), password });
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
        setError(err?.message || "Could not sign in. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your DataAuto workspace."
      footer={<>New to DataAuto? <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700">Create a workspace</Link></>}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormAlert message={error} onClose={() => setError(null)} />
        <div>
          <label className="da-label" htmlFor="login-email">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="login-email" type="email" autoComplete="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => clearError(x, "email")); }}
              placeholder="you@company.com" className={`da-input py-3 pl-10${invalid(errors.email)}`} {...ariaFor("login-email", errors.email)} />
          </div>
          <FieldError id="login-email" message={errors.email} />
        </div>
        <div>
          <label className="da-label" htmlFor="login-password">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="login-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((x) => clearError(x, "password")); }}
              placeholder="Your password" className={`da-input py-3 pl-10${invalid(errors.password)}`} {...ariaFor("login-password", errors.password)} />
          </div>
          <FieldError id="login-password" message={errors.password} />
        </div>
        <button type="submit" disabled={isSubmitting} className="da-btn da-btn-primary w-full py-3 text-[14px]">
          {isSubmitting ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}
        </button>
        <p className="flex items-center justify-center gap-1.5 pt-1 text-[12.5px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Your workspace is private to your account.
        </p>
      </form>
    </AuthShell>
  );
};
