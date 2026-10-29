import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "../services/api";
import { setPreferredTimeZone } from "../lib/schedule";

export interface User {
  id: number;
  name: string;
  email: string;
  timezone?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("auth_token"));
  // Without a stored token there is no session to check (and no placeholder to flash before the sign-in page).
  const [isLoading, setIsLoading] = useState<boolean>(() => !!localStorage.getItem("auth_token"));

  // Times and new schedules use the account's timezone when one is chosen in Account settings. Set while rendering
  // (not in an effect) so pages mounting in the same commit already read it.
  setPreferredTimeZone(user?.timezone ?? null);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem("auth_token");
      if (storedToken) {
        try {
          const res = await api.me();
          if (res?.user) {
            setUser(res.user);
            setToken(storedToken);
          } else {
            localStorage.removeItem("auth_token");
            setToken(null);
            setUser(null);
          }
        } catch {
          localStorage.removeItem("auth_token");
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  useEffect(() => {
    const onEnded = (e: Event) => {
      if (!localStorage.getItem("auth_token")) return;
      const detail = (e as CustomEvent<{ reason?: string; message?: string }>).detail ?? {};
      sessionStorage.setItem(
        "auth_notice",
        detail.reason === "suspended" && detail.message ? detail.message : "Your session ended. Please sign in again.",
      );
      localStorage.removeItem("auth_token");
      setToken(null);
      setUser(null);
    };
    window.addEventListener("auth:ended", onEnded);
    return () => window.removeEventListener("auth:ended", onEnded);
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("auth_token", newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    api.logout().catch(() => {});
    localStorage.removeItem("auth_token");
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const res = await api.me();
      if (res?.user) {
        setUser(res.user);
      }
    } catch {
      logout();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
