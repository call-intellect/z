import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { authApi } from "@/api/auth.api";
import { onAuthExpired } from "@/api/client";
import {
  clearSession,
  getUserId,
  loadSession,
  setUserId,
} from "@/api/session";
import { authUserFromApi, userFromMe, type AuthUser } from "@/domain/user";
import { registerPush, unregisterPush } from "@/push/registerPush";

interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  canSeeSupport: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const bootstrap = useCallback(async () => {
    await loadSession();
    if (!getUserId()) {
      setInitializing(false);
      return;
    }
    try {
      const me = await authApi.me();
      if (me.user) {
        setUser(userFromMe(me.user));
        void registerPush();
      } else {
        await clearSession();
      }
    } catch {
      await clearSession();
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const off = onAuthExpired(() => {
      setUser(null);
      void clearSession();
    });
    return off;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const mapped = authUserFromApi(res);
    await setUserId(mapped.id);
    setUser(mapped);
    void registerPush();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await unregisterPush();
      await authApi.logout();
    } catch {
      // ignore network errors on logout
    } finally {
      await clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      canSeeSupport: Boolean(user?.isAdmin || user?.isSuperAdmin),
      signIn,
      signOut,
    }),
    [user, initializing, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
