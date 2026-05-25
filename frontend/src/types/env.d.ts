declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_BASE_URL: string;
    NEXT_PUBLIC_LIVEKIT_URL: string;
    NEXT_PUBLIC_FRONTEND_URL: string;
    /**
     * β-9 / Phase 6 — username Telegram-бота Коры (без `@`).
     * Используется для построения deep-link `https://t.me/<username>?start=<code>`
     * на странице «Мои каналы» (кнопка «Открыть бота»). По умолчанию
     * `kora_bot`. Полное имя бота настраивается админом Z; для разных
     * окружений (stage/prod) — разные значения.
     */
    NEXT_PUBLIC_KORA_BOT_USERNAME?: string;
  }
}

export {};
