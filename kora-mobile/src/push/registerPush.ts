import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { BUILD_PUSH_TRANSPORT, type PushTransport } from "@/api/config";
import { pushApi } from "@/api/push.api";

let lastRegisteredToken: string | null = null;
let lastRegisteredTransport: PushTransport | null = null;

export function resolveTransport(): PushTransport {
  if (Platform.OS === "ios") return "apns";
  if (BUILD_PUSH_TRANSPORT === "rustore") return "rustore";
  return "fcm";
}

async function getNativeToken(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  const tokenResult = await Notifications.getDevicePushTokenAsync();
  return typeof tokenResult.data === "string" ? tokenResult.data : null;
}

export async function registerPush(): Promise<boolean> {
  if (!Device.isDevice) return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Сообщения",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const token = await getNativeToken();
  if (!token) return false;

  const transport = resolveTransport();
  await pushApi.register({
    transport,
    token,
    deviceInfo: {
      os: Platform.OS,
      osVersion: String(Platform.Version),
    },
  });
  lastRegisteredToken = token;
  lastRegisteredTransport = transport;
  return true;
}

export async function unregisterPush(): Promise<void> {
  if (!lastRegisteredToken || !lastRegisteredTransport) return;
  try {
    await pushApi.unregister(lastRegisteredToken, lastRegisteredTransport);
  } finally {
    lastRegisteredToken = null;
    lastRegisteredTransport = null;
  }
}
