import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  HelpCircle,
} from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

export interface SweetAlertOptions {
  title: string;
  text?: string;
  icon?: "success" | "error" | "warning" | "info" | "question";
  confirmButtonText?: string;
  cancelButtonText?: string;
  showCancelButton?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface ToastContextType {
  toast: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
  };
  showAlert: (options: SweetAlertOptions) => void;
  closeAlert: () => void;
}

const ToastContext = createContext<ToastContextType>({
  toast: {
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  },
  showAlert: () => {},
  closeAlert: () => {},
});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeAlert, setActiveAlert] = useState<SweetAlertOptions | null>(null);
  const toastIdRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, title: string, message?: string, duration = 4000) => {
      const id = `toast_${Date.now()}_${++toastIdRef.current}`;
      setToasts((prev) => [...prev.slice(-4), { id, type, title, message, duration }]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const toast = {
    success: (title: string, message?: string) => addToast("success", title, message),
    error: (title: string, message?: string) => addToast("error", title, message, 6000),
    warning: (title: string, message?: string) => addToast("warning", title, message),
    info: (title: string, message?: string) => addToast("info", title, message),
  };

  const showAlert = useCallback((options: SweetAlertOptions) => {
    setActiveAlert(options);
  }, []);

  const closeAlert = useCallback(() => {
    setActiveAlert(null);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showAlert, closeAlert }}>
      {children}

      {/* Floating Animated Toast Container */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.9 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg backdrop-blur-md transition-all ${
                t.type === "success"
                  ? "bg-white/95 border-emerald-200 text-slate-800 shadow-emerald-500/10"
                  : t.type === "error"
                  ? "bg-white/95 border-rose-200 text-slate-800 shadow-rose-500/10"
                  : t.type === "warning"
                  ? "bg-white/95 border-amber-200 text-slate-800 shadow-amber-500/10"
                  : "bg-white/95 border-indigo-200 text-slate-800 shadow-indigo-500/10"
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {t.type === "success" && (
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                )}
                {t.type === "error" && (
                  <div className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                )}
                {t.type === "warning" && (
                  <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                {t.type === "info" && (
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                    <Info className="w-4 h-4" />
                  </div>
                )}
              </div>

              <div className="flex-1 text-xs">
                <div className="font-bold text-slate-900 leading-tight">{t.title}</div>
                {t.message && (
                  <div className="text-slate-600 mt-0.5 text-[11px] leading-relaxed break-words">
                    {t.message}
                  </div>
                )}
              </div>

              <button
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-slate-700 p-1 -mr-1 -mt-1 rounded-md transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* SweetAlert Animated Modal Dialog */}
      <AnimatePresence>
        {activeAlert && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center space-y-4"
            >
              {/* SweetAlert Icon Animation */}
              <div className="mx-auto flex items-center justify-center">
                {activeAlert.icon === "success" && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-500/30 flex items-center justify-center text-emerald-600 shadow-lg shadow-emerald-500/10"
                  >
                    <CheckCircle2 className="w-9 h-9" />
                  </motion.div>
                )}
                {activeAlert.icon === "error" && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-rose-50 border-2 border-rose-500/30 flex items-center justify-center text-rose-600 shadow-lg shadow-rose-500/10"
                  >
                    <AlertCircle className="w-9 h-9" />
                  </motion.div>
                )}
                {activeAlert.icon === "warning" && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-500/30 flex items-center justify-center text-amber-600 shadow-lg shadow-amber-500/10"
                  >
                    <AlertTriangle className="w-9 h-9" />
                  </motion.div>
                )}
                {activeAlert.icon === "question" && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-indigo-50 border-2 border-indigo-500/30 flex items-center justify-center text-indigo-600 shadow-lg shadow-indigo-500/10"
                  >
                    <HelpCircle className="w-9 h-9" />
                  </motion.div>
                )}
                {(!activeAlert.icon || activeAlert.icon === "info") && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                    className="w-16 h-16 rounded-full bg-indigo-50 border-2 border-indigo-500/30 flex items-center justify-center text-indigo-600 shadow-lg shadow-indigo-500/10"
                  >
                    <Info className="w-9 h-9" />
                  </motion.div>
                )}
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  {activeAlert.title}
                </h3>
                {activeAlert.text && (
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {activeAlert.text}
                  </p>
                )}
              </div>

              <div className="pt-2 flex items-center justify-center gap-2.5">
                {activeAlert.showCancelButton && (
                  <button
                    onClick={() => {
                      if (activeAlert.onCancel) activeAlert.onCancel();
                      closeAlert();
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    {activeAlert.cancelButtonText || "Cancel"}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (activeAlert.onConfirm) activeAlert.onConfirm();
                    closeAlert();
                  }}
                  className="btn-primary-gradient px-5 py-2 text-white rounded-xl text-xs font-semibold shadow-xs transition"
                >
                  {activeAlert.confirmButtonText || "OK"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
