import { describe, expect, it } from "vitest";

import { mapTelegramChannelEntry } from "./me-channels";
import type { ChannelEntryApi } from "@/api/me-channels.api";

function telegramEntry(
  overrides: Partial<ChannelEntryApi["channel"]> = {},
  binding: ChannelEntryApi["binding"] = null,
): ChannelEntryApi {
  return {
    channel: {
      id: "ch-1",
      kind: "telegram_bot",
      direction: "bidirectional",
      status: "active",
      maxDataClass: "internal",
      ...overrides,
    },
    binding,
  };
}

describe("mapTelegramChannelEntry — состояние бота", () => {
  it("configured===false → channel_not_configured (приоритет над остальными)", () => {
    const view = mapTelegramChannelEntry(
      telegramEntry({ configured: false, botUsername: null }),
    );
    expect(view?.status).toBe("channel_not_configured");
    expect(view?.statusLabel).toBe("Не настроен");
    expect(view?.botUsername).toBeNull();
  });

  it("configured===false побеждает даже при status=disabled", () => {
    const view = mapTelegramChannelEntry(
      telegramEntry({ configured: false, status: "disabled" }),
    );
    expect(view?.status).toBe("channel_not_configured");
  });

  it("configured===true без привязки → not_linked, botUsername проброшен", () => {
    const view = mapTelegramChannelEntry(
      telegramEntry({ configured: true, botUsername: "kora_bot" }),
    );
    expect(view?.status).toBe("not_linked");
    expect(view?.botUsername).toBe("kora_bot");
  });

  it("configured отсутствует (undefined) — legacy: статус по привязке", () => {
    const view = mapTelegramChannelEntry(telegramEntry({}));
    expect(view?.status).toBe("not_linked");
    expect(view?.botUsername).toBeNull();
  });
});
