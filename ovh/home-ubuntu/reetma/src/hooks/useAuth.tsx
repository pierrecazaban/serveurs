// Back-office access for Reetma. There is no user database: a single admin account,
// stored as the ADMIN_EMAIL and ADMIN_PASSWORD environment variables on Vercel.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { adminLogin, clearAdminToken, getAdminToken } from "@/lib/admin";

interface AuthContextType {
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(() => !!getAdminToken());

  useEffect(() => {
    const id = window.setInterval(() => setIsAdmin(!!getAdminToken()), 60_000);
    return () => clearInterval(id);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await adminLogin(email, password);
    if (res.ok) setIsAdmin(true);
    return res;
  }, []);

  const signOut = useCallback(() => {
    clearAdminToken();
    setIsAdmin(false);
  }, []);

  return <AuthContext.Provider value={{ isAdmin, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const location = useLocation();
  if (!isAdmin) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}
