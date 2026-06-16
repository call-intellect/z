import { apiClient } from "./api-client";

export {
  listMyChannels,
  generateLinkCode,
  updateBindingPreferences,
  unlinkChannelBinding,
  type ChannelEntryApi,
  type ChannelBindingApi,
  type ChannelBindingPreferencesApi,
  type ChannelKindApi,
  type LinkCodeKindApi,
} from "./conversational.api";

export function buildTelegramDeepLink(
  linkCode: string,
  botUsername?: string | null,
): string {
  const username = (
    botUsername ||
    process.env.NEXT_PUBLIC_KORA_BOT_USERNAME ||
    "kora_bot"
  )
    .replace(/^@/, "")
    .trim();
  return `https://t.me/${username}?start=${encodeURIComponent(linkCode)}`;
}

export type ResetTelegramBindingResultApi = {
  ok: true;
  removed: number;
};

export async function resetTelegramBinding(): Promise<ResetTelegramBindingResultApi> {
  return apiClient.post<ResetTelegramBindingResultApi>(
    "/api/v1/me/channels/telegram_bot/reset",
    {},
  );
}
