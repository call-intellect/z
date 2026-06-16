const SW_URL = "/sw.js";

export function isPwaSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

function isEnabled(): boolean {
  if (!isPwaSupported()) return false;
  if (process.env.NODE_ENV === "production") return true;
  return process.env.NEXT_PUBLIC_PWA_ENABLE_IN_DEV === "1";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isEnabled()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: "/",
      updateViaCache: "none",
    });

    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[PWA] Service Worker зарегистрирован, scope:",
        registration.scope,
      );
    }

    return registration;
  } catch (error) {
    console.error("[PWA] Не удалось зарегистрировать Service Worker:", error);
    return null;
  }
}
