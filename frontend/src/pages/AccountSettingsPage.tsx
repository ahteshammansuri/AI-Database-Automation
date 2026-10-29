import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, KeyRound, Laptop, Loader2, LogOut, Save, UserRound } from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { FieldError, FormAlert, PageHeader } from "../components/ui/kit";
import { AccountSettingsSkeleton, UsageSkeleton } from "../components/ui/PageSkeletons";
import { TimezoneSelect } from "../components/ui/TimezoneSelect";
import { browserTimeZone, defaultTimeZone, formatInstant, relativeFromNow } from "../lib/schedule";
import { serverFieldErrors, type FieldErrors } from "../lib/validation";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { actionTarget, fieldTarget } from "../services/orbitSurfaces";
import { pageStateService } from "../services/pageStateService";

interface Session { id: number; name: string; created_at: string | null; last_used_at: string | null; expires_at: string | null; current: boolean }
interface ProfileData {
  profile: { id: number; name: string; email: string; timezone: string | null; created_at: string | null; last_active_at: string | null };
  workspace: { connections: number; automations: number; runs_this_month: number };
  sessions: Session[];
  password_min_length: number;
}
interface Usage {
  days: number;
  totals: { calls: number; prompt_tokens: number; completion_tokens: number };
  by_model: { provider: string | null; model: string | null; calls: number; prompt_tokens: number; completion_tokens: number }[];
  by_purpose: { purpose: string; label: string; calls: number; tokens: number }[];
}

const n = (v: number) => v.toLocaleString();
const ida = (id: string, err?: string | null) => ({ id, "aria-invalid": !!err, "aria-describedby": err ? `${id}-error` : undefined });

/** The signed-in customer's own account: profile, password, sessions and AI usage. */
export const AccountSettingsPage: React.FC = () => {
  const { refreshUser, logout } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [followBrowser, setFollowBrowser] = useState(true);
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [currentForEmail, setCurrentForEmail] = useState("");
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [pwErrors, setPwErrors] = useState<FieldErrors>({});
  const [savingPw, setSavingPw] = useState(false);

  const [busySession, setBusySession] = useState<number | "all" | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res: ProfileData = await api.getProfile();
      setData(res);
      setName(res.profile.name);
      setEmail(res.profile.email);
      setFollowBrowser(!res.profile.timezone);
      setTimezone(res.profile.timezone || browserTimeZone());
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message || "Your account could not be loaded.");
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/account", "Account settings");
    void load();
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.profileUsage(days).then((u) => { if (!cancelled) { setUsage(u); setUsageError(null); } })
      .catch((e: any) => !cancelled && setUsageError(e.message || "Usage could not be loaded."));
    return () => { cancelled = true; };
  }, [days]);

  const profileFormRef = useOrbitTarget<HTMLFormElement>("account.profile");
  const nameRef = useOrbitTarget<HTMLInputElement>(fieldTarget("account.profile", "name"));
  const emailRef = useOrbitTarget<HTMLInputElement>(fieldTarget("account.profile", "email"));
  const timezoneRef = useOrbitTarget<HTMLDivElement>(fieldTarget("account.profile", "timezone"));
  const saveProfileBtnRef = useOrbitTarget<HTMLButtonElement>(actionTarget("account.profile", "save"));

  const passwordFormRef = useOrbitTarget<HTMLFormElement>("account.password");
  const currentPwRef = useOrbitTarget<HTMLInputElement>(fieldTarget("account.password", "current_password"));
  const newPwRef = useOrbitTarget<HTMLInputElement>(fieldTarget("account.password", "password"));
  const confirmPwRef = useOrbitTarget<HTMLInputElement>(fieldTarget("account.password", "password_confirmation"));
  const savePwBtnRef = useOrbitTarget<HTMLButtonElement>(actionTarget("account.password", "save"));

  const sessionsRef = useOrbitTarget<HTMLDivElement>("account.sessions");

  useOrbitSurface("account.profile", () => ({
    target: "account.profile",
    fields: {
      name: {
        get: () => name,
        set: (v) => {
          setName(String(v ?? ""));
          setProfileErrors((x) => ({ ...x, name: "" }));
        },
        target: () => fieldTarget("account.profile", "name"),
      },
      email: {
        get: () => email,
        set: (v) => {
          setEmail(String(v ?? ""));
          setProfileErrors((x) => ({ ...x, email: "" }));
        },
        target: () => fieldTarget("account.profile", "email"),
      },
      timezone: {
        get: () => (followBrowser ? browserTimeZone() : timezone),
        set: (v) => {
          const val = String(v ?? "").trim();
          if (!val || val === "browser" || val === "auto") {
            setFollowBrowser(true);
            setTimezone(browserTimeZone());
          } else {
            setFollowBrowser(false);
            setTimezone(val);
          }
          setProfileErrors((x) => ({ ...x, timezone: "" }));
        },
        target: () => fieldTarget("account.profile", "timezone"),
      },
    },
    actions: {
      save: {
        target: () => actionTarget("account.profile", "save"),
        run: async () => {
          const errs: FieldErrors = {};
          if (!name.trim()) errs.name = "Enter your name.";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address.";
          const emailChanged = data ? email.trim().toLowerCase() !== data.profile.email.toLowerCase() : false;
          if (emailChanged && !currentForEmail) errs.current_password = "Enter your current password to change your email address.";
          setProfileErrors(errs);
          if (Object.keys(errs).length) {
            return { success: false, message: Object.values(errs)[0] };
          }
          setSavingProfile(true);
          try {
            await api.updateProfile({
              name: name.trim(),
              email: email.trim(),
              timezone: followBrowser ? null : timezone,
              current_password: emailChanged ? currentForEmail : undefined,
            });
            setCurrentForEmail("");
            await Promise.all([refreshUser(), load()]);
            toast.success("Profile saved", followBrowser ? "Times follow this browser's timezone." : `Times and new schedules use ${timezone}.`);
            return { success: true, message: `Profile saved: Name updated to '${name.trim()}'.` };
          } catch (err: any) {
            const f = serverFieldErrors(err);
            if (Object.keys(f).length) setProfileErrors(f);
            return { success: false, message: err.message || "Profile not saved." };
          } finally {
            setSavingProfile(false);
          }
        },
      },
    },
    describe: () => ({
      name,
      email,
      timezone: followBrowser ? `Browser (${browserTimeZone()})` : timezone,
    }),
  }));

  useOrbitSurface("account.password", () => ({
    target: "account.password",
    fields: {
      current_password: {
        get: () => "",
        set: (v) => { setPw((p) => ({ ...p, current: String(v ?? "") })); setPwErrors((x) => ({ ...x, current_password: "" })); },
        target: () => fieldTarget("account.password", "current_password"),
      },
      password: {
        get: () => "",
        set: (v) => { setPw((p) => ({ ...p, next: String(v ?? "") })); setPwErrors((x) => ({ ...x, password: "" })); },
        target: () => fieldTarget("account.password", "password"),
      },
      password_confirmation: {
        get: () => "",
        set: (v) => { setPw((p) => ({ ...p, confirm: String(v ?? "") })); setPwErrors((x) => ({ ...x, password_confirmation: "" })); },
        target: () => fieldTarget("account.password", "password_confirmation"),
      },
    },
    actions: {
      save: {
        target: () => actionTarget("account.password", "save"),
        run: async () => {
          const min = data?.password_min_length || 6;
          const errs: FieldErrors = {};
          if (!pw.current) errs.current_password = "Enter your current password.";
          if (pw.next.length < min) errs.password = `Use at least ${min} characters.`;
          else if (pw.next === pw.current) errs.password = "Choose a password different from the current one.";
          if (pw.confirm !== pw.next) errs.password_confirmation = "The two new passwords do not match.";
          setPwErrors(errs);
          if (Object.keys(errs).length) return { success: false, message: Object.values(errs)[0] };
          setSavingPw(true);
          try {
            const res = await api.changePassword({ current_password: pw.current, password: pw.next, password_confirmation: pw.confirm, sign_out_others: signOutOthers });
            setPw({ current: "", next: "", confirm: "" });
            toast.success("Password changed", res?.message);
            void load();
            return { success: true, message: res?.message || "Password changed successfully." };
          } catch (err: any) {
            const f = serverFieldErrors(err);
            if (Object.keys(f).length) setPwErrors(f);
            return { success: false, message: err.message || "Password not changed." };
          } finally {
            setSavingPw(false);
          }
        },
      },
    },
  }));

  useOrbitSurface("account.sessions", () => ({
    target: "account.sessions",
    actions: {
      sign_out: {
        target: (row) => actionTarget("account.sessions", "sign_out", row),
        run: async (row) => {
          const id = row ? parseInt(row, 10) : undefined;
          await signOut(id);
          return { success: true, message: `Signed out session #${row}.` };
        },
      },
      sign_out_all: {
        target: () => actionTarget("account.sessions", "sign_out_all"),
        run: async () => {
          await signOut();
          return { success: true, message: "Signed out all other sessions." };
        },
      },
    },
    describe: () => ({
      sessions: (data?.sessions || []).map((s) => ({ id: s.id, current: s.current, name: s.name, last_used: s.last_used_at })),
    }),
  }));

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader eyebrow="Account" title="Account settings" />
        {loadError ? <FormAlert message={loadError} /> : <AccountSettingsSkeleton />}
      </div>
    );
  }

  const emailChanged = email.trim().toLowerCase() !== data.profile.email.toLowerCase();
  const min = data.password_min_length;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address.";
    if (emailChanged && !currentForEmail) errs.current_password = "Enter your current password to change your email address.";
    setProfileErrors(errs);
    if (Object.keys(errs).length) return;
    setSavingProfile(true);
    try {
      await api.updateProfile({ name: name.trim(), email: email.trim(), timezone: followBrowser ? null : timezone, current_password: emailChanged ? currentForEmail : undefined });
      setCurrentForEmail("");
      await Promise.all([refreshUser(), load()]);
      toast.success("Profile saved", followBrowser ? "Times follow this browser's timezone." : `Times and new schedules use ${timezone}.`);
    } catch (err: any) {
      const f = serverFieldErrors(err);
      if (Object.keys(f).length) setProfileErrors(f);
      else toast.error("Profile not saved", err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: FieldErrors = {};
    if (!pw.current) errs.current_password = "Enter your current password.";
    if (pw.next.length < min) errs.password = `Use at least ${min} characters.`;
    else if (pw.next === pw.current) errs.password = "Choose a password different from the current one.";
    if (pw.confirm !== pw.next) errs.password_confirmation = "The two new passwords do not match.";
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    setSavingPw(true);
    try {
      const res = await api.changePassword({ current_password: pw.current, password: pw.next, password_confirmation: pw.confirm, sign_out_others: signOutOthers });
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Password changed", res?.message);
      void load();
    } catch (err: any) {
      const f = serverFieldErrors(err);
      if (Object.keys(f).length) setPwErrors(f);
      else toast.error("Password not changed", err.message);
    } finally {
      setSavingPw(false);
    }
  };

  const signOut = async (id?: number) => {
    setBusySession(id ?? "all");
    try {
      const res = await api.signOutSession(id);
      toast.success("Signed out", res?.message);
      await load();
    } catch (err: any) {
      toast.error("Not signed out", err.message);
    } finally {
      setBusySession(null);
    }
  };

  const others = data.sessions.filter((s) => !s.current);
  const tz = defaultTimeZone();
  const totalTokens = usage ? usage.totals.prompt_tokens + usage.totals.completion_tokens : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Account settings"
        description={`Your profile, password and signed-in devices. Member since ${data.profile.created_at ? formatInstant(data.profile.created_at, tz) : "—"} · ${data.workspace.connections} connection${data.workspace.connections === 1 ? "" : "s"}, ${data.workspace.automations} scheduled automation${data.workspace.automations === 1 ? "" : "s"}, ${data.workspace.runs_this_month} run${data.workspace.runs_this_month === 1 ? "" : "s"} this month.`}
      />

      <form ref={profileFormRef} onSubmit={saveProfile} noValidate className="da-card space-y-5 p-6">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-slate-900"><UserRound className="h-4 w-4 text-indigo-600" /> Profile</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="da-label" htmlFor="acct-name">Name</label>
            <input ref={nameRef} {...ida("acct-name", profileErrors.name)} value={name} maxLength={255} autoComplete="name"
              onChange={(e) => { setName(e.target.value); setProfileErrors((x) => ({ ...x, name: "" })); }} className={`da-input${profileErrors.name ? " da-input-invalid" : ""}`} />
            <FieldError id="acct-name" message={profileErrors.name} />
          </div>
          <div>
            <label className="da-label" htmlFor="acct-email">Email</label>
            <input ref={emailRef} {...ida("acct-email", profileErrors.email)} type="email" value={email} maxLength={255} autoComplete="email"
              onChange={(e) => { setEmail(e.target.value); setProfileErrors((x) => ({ ...x, email: "" })); }} className={`da-input${profileErrors.email ? " da-input-invalid" : ""}`} />
            <FieldError id="acct-email" message={profileErrors.email} />
          </div>
          {emailChanged && (
            <div className="sm:col-span-2">
              <label className="da-label" htmlFor="acct-current-email">Current password (needed to change your email)</label>
              <input {...ida("acct-current-email", profileErrors.current_password)} type="password" value={currentForEmail} autoComplete="current-password"
                onChange={(e) => { setCurrentForEmail(e.target.value); setProfileErrors((x) => ({ ...x, current_password: "" })); }} className={`da-input max-w-sm${profileErrors.current_password ? " da-input-invalid" : ""}`} />
              <FieldError id="acct-current-email" message={profileErrors.current_password} />
              <p className="da-help">Approval emails go to your new address from now on.</p>
            </div>
          )}
          <div ref={timezoneRef} className="sm:col-span-2">
            <span className="da-label">Timezone</span>
            <label className="mb-2 flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={followBrowser} onChange={(e) => setFollowBrowser(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
              Follow this browser ({browserTimeZone()})
            </label>
            {!followBrowser && <div className="max-w-sm"><TimezoneSelect id="acct-tz" value={timezone} onChange={setTimezone} /></div>}
            <FieldError id="acct-tz" message={profileErrors.timezone} />
            <p className="da-help">Used to show times and as the default for new schedules. Each automation keeps its own timezone.</p>
          </div>
        </div>
        <div className="flex justify-end">
          <button ref={saveProfileBtnRef} type="submit" disabled={savingProfile} className="da-btn da-btn-primary">
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
          </button>
        </div>
      </form>

      <form ref={passwordFormRef} onSubmit={savePassword} noValidate className="da-card space-y-5 p-6">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-slate-900"><KeyRound className="h-4 w-4 text-indigo-600" /> Password</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="da-label" htmlFor="acct-current_password">Current password</label>
            <input ref={currentPwRef} {...ida("acct-current_password", pwErrors.current_password)} type="password" value={pw.current} autoComplete="current-password" maxLength={255}
              onChange={(e) => { setPw((p) => ({ ...p, current: e.target.value })); setPwErrors((x) => ({ ...x, current_password: "" })); }}
              className={`da-input${pwErrors.current_password ? " da-input-invalid" : ""}`} />
            <FieldError id="acct-current_password" message={pwErrors.current_password} />
          </div>
          <div>
            <label className="da-label" htmlFor="acct-password">New password</label>
            <input ref={newPwRef} {...ida("acct-password", pwErrors.password)} type="password" value={pw.next} autoComplete="new-password" maxLength={255}
              onChange={(e) => { setPw((p) => ({ ...p, next: e.target.value })); setPwErrors((x) => ({ ...x, password: "" })); }}
              className={`da-input${pwErrors.password ? " da-input-invalid" : ""}`} />
            <FieldError id="acct-password" message={pwErrors.password} />
          </div>
          <div>
            <label className="da-label" htmlFor="acct-password_confirmation">Repeat the new password</label>
            <input ref={confirmPwRef} {...ida("acct-password_confirmation", pwErrors.password_confirmation)} type="password" value={pw.confirm} autoComplete="new-password" maxLength={255}
              onChange={(e) => { setPw((p) => ({ ...p, confirm: e.target.value })); setPwErrors((x) => ({ ...x, password_confirmation: "" })); }}
              className={`da-input${pwErrors.password_confirmation ? " da-input-invalid" : ""}`} />
            <FieldError id="acct-password_confirmation" message={pwErrors.password_confirmation} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
            Sign out my other sessions
          </label>
          <span className="flex items-center gap-3">
            <span className="text-[12px] text-slate-500">At least {min} characters.</span>
            <button ref={savePwBtnRef} type="submit" disabled={savingPw} className="da-btn da-btn-primary">
              {savingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Change password
            </button>
          </span>
        </div>
      </form>

      <section ref={sessionsRef} className="da-card p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-slate-900"><Laptop className="h-4 w-4 text-indigo-600" /> Signed-in sessions · {data.sessions.length}</h2>
          {others.length > 0 && (
            <button type="button" onClick={() => signOut()} disabled={busySession !== null} className="da-btn da-btn-secondary da-btn-sm">
              {busySession === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out all others
            </button>
          )}
        </div>
        <ul className="divide-y divide-slate-100">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]">
              <span>
                <span className="font-semibold text-slate-800">{s.current ? "This browser" : `Session #${s.id}`}</span>
                {s.current && <span className="da-chip da-chip-emerald ml-2 px-2 text-[10.5px]">Current</span>}
                <span className="block text-[12px] text-slate-500">
                  Signed in {s.created_at ? formatInstant(s.created_at, tz) : "—"} · last used {s.last_used_at ? relativeFromNow(s.last_used_at) : "never"}
                </span>
              </span>
              {s.current ? (
                <button type="button" onClick={logout} className="da-btn da-btn-ghost da-btn-sm text-rose-600 hover:bg-rose-50">Sign out</button>
              ) : (
                <button type="button" onClick={() => signOut(s.id)} disabled={busySession !== null} className="da-btn da-btn-secondary da-btn-sm">
                  {busySession === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="da-card p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-slate-900"><Cpu className="h-4 w-4 text-indigo-600" /> AI usage</h2>
          <div className="da-tabs" role="tablist" aria-label="Period">
            {([7, 30, 90] as const).map((d) => (
              <button key={d} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`da-tab ${days === d ? "da-tab-active" : ""}`}>{d} days</button>
            ))}
          </div>
        </div>
        <FormAlert message={usageError} />
        {!usage ? (usageError ? null : <UsageSkeleton />) : usage.totals.calls === 0 ? (
          <p className="text-[13px] text-slate-500">No AI calls in the last {usage.days} days.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-[13.5px] text-slate-700">
              <strong>{n(totalTokens)} tokens</strong> in {n(usage.totals.calls)} call{usage.totals.calls === 1 ? "" : "s"} over the last {usage.days} days
              ({n(usage.totals.prompt_tokens)} sent, {n(usage.totals.completion_tokens)} written by the model). Local models are free; cloud providers bill these tokens on your own account.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="da-table">
                  <thead><tr><th>Model</th><th className="text-right">Calls</th><th className="text-right">Tokens</th></tr></thead>
                  <tbody>
                    {usage.by_model.map((m, i) => (
                      <tr key={i}>
                        <td><span className="font-mono text-[12px]">{m.model || "—"}</span> <span className="text-[11px] text-slate-400">{m.provider}</span></td>
                        <td className="text-right tabular-nums">{n(m.calls)}</td>
                        <td className="text-right tabular-nums">{n(m.prompt_tokens + m.completion_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="da-table">
                  <thead><tr><th>Used for</th><th className="text-right">Calls</th><th className="text-right">Tokens</th></tr></thead>
                  <tbody>
                    {usage.by_purpose.map((p) => (
                      <tr key={p.purpose}><td>{p.label}</td><td className="text-right tabular-nums">{n(p.calls)}</td><td className="text-right tabular-nums">{n(p.tokens)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[12px] text-slate-500">Choose which model writes content and which one runs Orbit on the <Link to="/ai-providers" className="font-semibold text-indigo-600 hover:underline">AI providers</Link> page.</p>
          </div>
        )}
      </section>
    </div>
  );
};
