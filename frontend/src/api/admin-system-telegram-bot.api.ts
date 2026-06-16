import { apiClient } from "./api-client";
import type {
  TelegramBotBindingsPageApiDto,
  TelegramBotProxyPingApiDto,
  TelegramBotSettingsApiDto,
} from "@/domain/admin-telegram-bot";

export const adminSystemTelegramBotApi = {
  fetchSettings: (): Promise<TelegramBotSettingsApiDto> =>
    apiClient.get<TelegramBotSettingsApiDto>(
      "/api/v1/admin/system/telegram-bot",
    ),

  updateToken: (args: { token: string }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      "/api/v1/admin/system/telegram-bot/token",
      { token: args.token },
    ),

  resetWebhook: (args?: {
    webhookUrl?: string;
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      "/api/v1/admin/system/telegram-bot/webhook",
      args?.webhookUrl ? { webhookUrl: args.webhookUrl } : {},
    ),

  updateTemplates: (args: {
    welcome?: string;
    notLinked?: string;
    employeeOffboarded?: string;
    orgFrozen?: string;
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      "/api/v1/admin/system/telegram-bot/templates",
      args,
    ),

  setStatus: (args: {
    status: "active" | "global_disabled";
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      "/api/v1/admin/system/telegram-bot/status",
      { status: args.status },
    ),

  fetchBindings: (args?: {
    orgId?: string;
    status?:
      | "linked"
      | "pending"
      | "no_membership"
      | "bot_blocked"
      | "inactive";
    page?: number;
    pageSize?: number;
  }): Promise<TelegramBotBindingsPageApiDto> => {
    const params = new URLSearchParams();
    if (args?.orgId) params.set("orgId", args.orgId);
    if (args?.status) params.set("status", args.status);
    if (args?.page) params.set("page", String(args.page));
    if (args?.pageSize) params.set("pageSize", String(args.pageSize));
    const qs = params.toString();
    return apiClient.get<TelegramBotBindingsPageApiDto>(
      `/api/v1/admin/system/telegram-bot/bindings${qs ? `?${qs}` : ""}`,
    );
  },

  pingProxy: (): Promise<TelegramBotProxyPingApiDto> =>
    apiClient.post<TelegramBotProxyPingApiDto>(
      "/api/v1/admin/system/telegram-bot/ping",
      {},
    ),
};
