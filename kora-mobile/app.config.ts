import type { ExpoConfig } from "expo/config";

const PUSH_TRANSPORT = process.env.EXPO_PUBLIC_PUSH_TRANSPORT ?? "fcm";

const config: ExpoConfig = {
  name: "Кора",
  slug: "kora-mobile",
  scheme: "kora",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: "ru.korateam.mobile",
    supportsTablet: false,
    infoPlist: {
      NSMicrophoneUsageDescription: "Запись голосовых сообщений",
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType:
            "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  android: {
    package: "ru.korateam.mobile",
    permissions: ["RECORD_AUDIO", "POST_NOTIFICATIONS", "INTERNET"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0B0F19",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#0B0F19",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Запись голосовых сообщений",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#4F8CFF",
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "https://korateam.ru",
    pushTransport: PUSH_TRANSPORT,
  },
};

export default config;
