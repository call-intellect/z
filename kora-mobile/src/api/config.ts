import Constants from "expo-constants";

type Extra = {
  apiUrl?: string;
  pushTransport?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "https://korateam.ru";

export type PushTransport = "apns" | "fcm" | "rustore";

export const BUILD_PUSH_TRANSPORT: string =
  process.env.EXPO_PUBLIC_PUSH_TRANSPORT ?? extra.pushTransport ?? "fcm";
