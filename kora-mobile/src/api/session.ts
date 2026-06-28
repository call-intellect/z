import * as SecureStore from "expo-secure-store";

const SESSION_COOKIE_KEY = "kora.session.cookie";
const ORG_ID_KEY = "kora.session.orgId";
const USER_ID_KEY = "kora.session.userId";

let cachedCookie: string | null = null;
let cachedOrgId: string | null = null;
let cachedUserId: string | null = null;

export async function loadSession(): Promise<void> {
  cachedCookie = await SecureStore.getItemAsync(SESSION_COOKIE_KEY);
  cachedOrgId = await SecureStore.getItemAsync(ORG_ID_KEY);
  cachedUserId = await SecureStore.getItemAsync(USER_ID_KEY);
}

export function getSessionCookie(): string | null {
  return cachedCookie;
}

export function getOrgId(): string | null {
  return cachedOrgId;
}

export function getUserId(): string | null {
  return cachedUserId;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  cachedCookie = cookie;
  if (cookie) {
    await SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookie);
  } else {
    await SecureStore.deleteItemAsync(SESSION_COOKIE_KEY);
  }
}

export async function setOrgId(orgId: string | null): Promise<void> {
  cachedOrgId = orgId;
  if (orgId) {
    await SecureStore.setItemAsync(ORG_ID_KEY, orgId);
  } else {
    await SecureStore.deleteItemAsync(ORG_ID_KEY);
  }
}

export async function setUserId(userId: string | null): Promise<void> {
  cachedUserId = userId;
  if (userId) {
    await SecureStore.setItemAsync(USER_ID_KEY, userId);
  } else {
    await SecureStore.deleteItemAsync(USER_ID_KEY);
  }
}

export async function clearSession(): Promise<void> {
  await setSessionCookie(null);
  await setOrgId(null);
  await setUserId(null);
}

export function extractSessionCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/z_session=[^;]+/);
  return match ? match[0] : null;
}
