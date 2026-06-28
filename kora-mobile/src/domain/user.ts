import type { LoginResponseApi, UserApi } from "@/api/auth.api";

export type AppRole = "agent" | "client" | "member";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
}

export function authUserFromApi(api: LoginResponseApi): AuthUser {
  return {
    id: api.user.id,
    email: api.user.email,
    name: api.user.name,
    isSuperAdmin: api.isSuperAdmin,
    isAdmin: api.role === "admin",
  };
}

export function userFromMe(api: UserApi): AuthUser {
  return {
    id: api.id,
    email: api.email,
    name: api.name,
    isSuperAdmin: false,
    isAdmin: api.role === "admin",
  };
}
