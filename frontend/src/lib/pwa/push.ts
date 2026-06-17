import { apiClient } from "@/api/api-client";
import { ApiError } from "@/api/api-error";
import { isPwaSupported } from "./register-sw";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export function isPushSupported(): boolean {
  return (
    isPwaSupported() &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

export function getPermission(): PushPermission {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as PushPermission;
}

export async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return navigator.serviceWorker.ready;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await getActiveRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error("Push-уведомления не поддерживаются вашим браузером.");
  }

  const vapidKey = getVapidPublicKey();
  if (!vapidKey) {
    throw new Error(
      "Push-уведомления временно недоступны: не настроен VAPID-ключ. Обратитесь к администратору.",
    );
  }

  const reg = await getActiveRegistration();
  if (!reg) {
    throw new Error(
      "Service Worker не зарегистрирован. Перезагрузите страницу.",
    );
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Вы не дали разрешение на уведомления.");
    }
  }
  if (Notification.permission === "denied") {
    throw new Error(
      "Уведомления запрещены в настройках браузера. Разрешите их вручную и попробуйте снова.",
    );
  }

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await sendSubscriptionToServer(existing);
    return existing;
  }

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  await sendSubscriptionToServer(subscription);
  return subscription;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const existing = await getExistingSubscription();
  if (!existing) return false;

  try {
    await apiClient.del("/api/v1/me/push-subscriptions", {
      body: { endpoint: existing.endpoint },
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "http_404") {
      console.warn(
        "[PWA] Backend endpoint для push-подписок не реализован (404). TODO",
      );
    } else {
      console.warn("[PWA] Не удалось удалить подписку на сервере:", err);
    }
  }

  return existing.unsubscribe();
}

async function sendSubscriptionToServer(
  subscription: PushSubscription,
): Promise<void> {
  const payload = subscription.toJSON();
  try {
    await apiClient.post("/api/v1/me/push-subscriptions", {
      endpoint: payload.endpoint,
      keys: payload.keys,
      expirationTime: payload.expirationTime ?? null,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "http_404") {
      console.warn(
        "[PWA] POST /api/v1/me/push-subscriptions вернул 404. Backend для web-push ещё не готов (TODO).",
      );
      return;
    }
    throw err;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = typeof atob === "function" ? atob(base64) : "";
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    view[i] = rawData.charCodeAt(i);
  }
  return buffer;
}
