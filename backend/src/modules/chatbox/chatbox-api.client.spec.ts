import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { ChatboxApiClient, ChatboxApiError } from './chatbox-api.client';

const TOKEN = 'tok_abc123';

const cfgStub = {
  chatbox: { apiBaseUrl: 'https://example.test' },
} as unknown as TypedConfigService;

function lastFetchCall(): { url: string; init: RequestInit } {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe('ChatboxApiClient', () => {
  let client: ChatboxApiClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new ChatboxApiClient(cfgStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('listWorkspaces: строит URL+query, шлёт Bearer-токен, возвращает тело', async () => {
    const payload = {
      workspaces: [{ id: 'w1', name: 'A', role: 'USER' }],
      total: 1,
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson(payload));

    const res = await client.listWorkspaces(TOKEN, { limit: 3, search: 'x' });

    expect(res).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces'),
      expect.objectContaining({ method: 'GET' }),
    );

    const { url, init } = lastFetchCall();
    expect(url).toContain('limit=3');
    expect(url).toContain('search=x');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('listChats: URL содержит /workspaces/ws1/chats и query status/order', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      okJson({ chats: [], total: 0 }),
    );

    await client.listChats(TOKEN, 'ws1', { status: 'ACTIVE', order: 'asc' });

    const { url } = lastFetchCall();
    expect(url).toContain('/workspaces/ws1/chats');
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('order=asc');
  });

  it('401 → ChatboxApiError, status=401, transient=false', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'unauthorized' }),
    } as unknown as Response);

    await expect(client.listWorkspaces(TOKEN)).rejects.toMatchObject({
      status: 401,
      transient: false,
    });
    await expect(client.listWorkspaces(TOKEN)).rejects.toBeInstanceOf(ChatboxApiError);
  });

  it('503 → ChatboxApiError, transient=true', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'unavailable' }),
    } as unknown as Response);

    await expect(client.listWorkspaces(TOKEN)).rejects.toMatchObject({
      status: 503,
      transient: true,
    });
  });

  it('сетевая ошибка → ChatboxApiError, status=0, transient=true', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await client.listWorkspaces(TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatboxApiError);
    expect((err as ChatboxApiError).status).toBe(0);
    expect((err as ChatboxApiError).transient).toBe(true);
  });
});
