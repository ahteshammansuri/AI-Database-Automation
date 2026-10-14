import React, { useState } from "react";
import { ShieldCheck, Eye, EyeOff, Database, Lock } from "lucide-react";

interface SecureCredentialCardProps {
  onSubmit: (data: any) => void;
  disabled?: boolean;
  isLoading?: boolean;
  onCancel?: () => void;
}

export const SecureCredentialCard: React.FC<SecureCredentialCardProps> = ({
  onSubmit,
  disabled = false,
  isLoading = false,
  onCancel,
}) => {
  const [name, setName] = useState<string>("Production MySQL");
  const [host, setHost] = useState<string>("127.0.0.1");
  const [port, setPort] = useState<number>(3308);
  const [database, setDatabase] = useState<string>("demo_blog_cms");
  const [username, setUsername] = useState<string>("root");
  const [password, setPassword] = useState<string>("ipo_root_password");
  const [sslMode, setSslMode] = useState<string>("prefer");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      host,
      port: Number(port),
      database,
      username,
      password,
      ssl_mode: sslMode,
    });
  };

  return (
    <div className="mt-3 p-4 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-xl text-slate-100 max-w-md">
      <div className="flex items-center space-x-2 text-indigo-400 font-semibold mb-3">
        <Lock className="w-4 h-4 text-emerald-400" />
        <span className="text-sm">Secure Credential Input</span>
        <span className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
          AES-256 Encrypted
        </span>
      </div>

      <p className="text-xs text-slate-300 mb-4 leading-relaxed">
        Credentials entered here are sent directly to the secure control plane and encrypted at rest.
        They are <strong>never</strong> logged or passed into LLM prompts.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Connection Label</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            placeholder="e.g. Primary MySQL"
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Host</label>
            <input
              type="text"
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={disabled}
              placeholder="127.0.0.1"
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Port</label>
            <input
              type="number"
              required
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              disabled={disabled}
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Database Name</label>
          <input
            type="text"
            required
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            disabled={disabled}
            placeholder="my_database"
            className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Username</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={disabled}
              placeholder="db_user"
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">SSL Mode</label>
            <select
              value={sslMode}
              onChange={(e) => setSslMode(e.target.value)}
              disabled={disabled}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="prefer">Prefer (Auto)</option>
              <option value="require">Require (SSL)</option>
              <option value="disable">Disable</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Database Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled}
              placeholder="••••••••••••"
              className="w-full pl-3 pr-9 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button
            type="submit"
            disabled={disabled || isLoading}
            className="flex-1 py-2 px-4 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] transition shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Verify & Save Connection</span>
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="py-2 px-3 rounded-xl text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
