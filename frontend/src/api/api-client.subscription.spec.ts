import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClient } from "./api-client";
import { ApiError } from "./api-error";

function mockFetchResponse(status: number, body: unknown) {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

describe("ApiClient — subscription_required interceptor", () => {
  const client = new ApiClient("http://test");
  let listener: EventListener;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch");
    listener = vi.fn() as EventListener;
    window.addEventListener("subscription:required", listener);
  });

  afterEach(() => {
    window.removeEventListener("subscription:required", listener);
  });

  it("403 subscription_required → dispatch event + бросает ApiError", async () => {
    mockFetchResponse(403, {
      ok: false,
      error: {
        code: "subscription_required",
        message: "Оплатите подписку, чтобы начать работу",
        currentStatus: "DEMO",
        price: 60000,
        currency: "RUB",
        paymentUrl: "/settings/subscription",
      },
    });

    await expect(client.post("/api/v1/meetings", {})).rejects.toThrow(ApiError);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('403 subscription_required → ApiError.code === "subscription_required"', async () => {
    mockFetchResponse(403, {
      ok: false,
      error: {
        code: "subscription_required",
        message: "Оплатите подписку",
      },
    });

    try {
      await client.post("/api/v1/meetings", {});
      expect.unreachable("должен был бросить");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("subscription_required");
    }
  });

  it("403 другой код → НЕ dispatch event", async () => {
    mockFetchResponse(403, {
      ok: false,
      error: {
        code: "rbac_denied",
        message: "Нет доступа",
      },
    });

    await expect(client.get("/api/v1/meetings")).rejects.toThrow(ApiError);
    expect(listener).not.toHaveBeenCalled();
  });

  it("200 OK → возвращает данные, без event", async () => {
    mockFetchResponse(200, { id: "1", name: "test" });

    const result = await client.get<{ id: string; name: string }>(
      "/api/v1/meetings",
    );
    expect(result).toEqual({ id: "1", name: "test" });
    expect(listener).not.toHaveBeenCalled();
  });
});
