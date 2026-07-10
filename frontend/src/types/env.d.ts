declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_BASE_URL: string;
    NEXT_PUBLIC_LIVEKIT_URL: string;
    NEXT_PUBLIC_FRONTEND_URL: string;
    NEXT_PUBLIC_KORA_BOT_USERNAME?: string;
    NEXT_PUBLIC_WS_URL?: string;
    NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
    NEXT_PUBLIC_PWA_ENABLE_IN_DEV?: string;
  }
}

export {};
