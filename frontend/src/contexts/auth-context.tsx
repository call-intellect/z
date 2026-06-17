"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { accountsApi } from "@/api/accounts.api";
import { setApiClientOrgId } from "@/api/api-client";
import { ApiError } from "@/api/api-error";
import { authApi } from "@/api/auth.api";
import {
  mapAccountUserDtoToDomain,
  type AccountUser,
  type CurrentOrgRole,
  type SignupSource,
} from "@/domain/account";

type AuthState = {
  user: AccountUser | null;
  isLoading: boolean;
};

type AuthContextValue = AuthState & {
  mustChangePassword: boolean;
  signupSource: SignupSource | null;
  isSuperAdmin: boolean;
  currentOrgRole: CurrentOrgRole;
  currentOrgId: string | null;
  profileCompletedAt: Date | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loginStandalone: (
    email: string,
    password: string,
  ) => Promise<{ mustChangePassword: boolean }>;
  login: (
    email: string,
    password: string,
  ) => Promise<{
    mustChangePassword: boolean;
    isSuperAdmin: boolean;
    role: "user" | "admin";
  }>;
  register: (
    email: string,
    name: string,
    phone?: string,
    companyName?: string,
    honeypot?: string,
    ref?: string,
    consentDataProcessing?: boolean,
    consentMarketing?: boolean,
  ) => Promise<{ emailSent: boolean }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const res = await accountsApi.me();
      setState({
        user: res.user ? mapAccountUserDtoToDomain(res.user) : null,
        isLoading: false,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "unauthorized") {
        setState({ user: null, isLoading: false });
        return;
      }
      setState({ user: null, isLoading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await accountsApi.logout();
    } catch {
      try {
        await authApi.logout();
      } catch {}
    }
    setState({ user: null, isLoading: false });
  }, []);

  const loginStandalone = useCallback(
    async (email: string, password: string) => {
      const res = await accountsApi.login({ email, password });
      await refresh();
      return { mustChangePassword: res.mustChangePassword };
    },
    [refresh],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login({ email, password });
      await refresh();
      return {
        mustChangePassword: res.mustChangePassword,
        isSuperAdmin: res.isSuperAdmin === true,
        role: res.role,
      };
    },
    [refresh],
  );

  const register = useCallback(
    async (
      email: string,
      name: string,
      phone?: string,
      companyName?: string,
      honeypot?: string,
      ref?: string,
      consentDataProcessing?: boolean,
      consentMarketing?: boolean,
    ) => {
      const res = await accountsApi.register({
        email,
        name,
        ...(phone ? { phone } : {}),
        ...(companyName ? { companyName } : {}),
        ...(honeypot !== undefined ? { honeypot } : {}),
        ...(ref ? { ref } : {}),
        ...(consentDataProcessing !== undefined
          ? { consentDataProcessing }
          : {}),
        ...(consentMarketing !== undefined ? { consentMarketing } : {}),
      });
      return { emailSent: res.email_sent };
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      setState({ user: null, isLoading: false });
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  useEffect(() => {
    setApiClientOrgId(state.user?.currentOrgId ?? null);
  }, [state.user?.currentOrgId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      isLoading: state.isLoading,
      mustChangePassword: state.user?.mustChangePassword ?? false,
      signupSource: state.user?.signupSource ?? null,
      isSuperAdmin: state.user?.isSuperAdmin === true,
      currentOrgRole: state.user?.currentOrgRole ?? null,
      currentOrgId: state.user?.currentOrgId ?? null,
      profileCompletedAt: state.user?.profileCompletedAt ?? null,
      refresh,
      logout,
      loginStandalone,
      login,
      register,
    }),
    [
      state.user,
      state.isLoading,
      refresh,
      logout,
      loginStandalone,
      login,
      register,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
