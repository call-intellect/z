import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

export interface ChatboxWorkspace {
  id: string;
  name: string;
  description?: string | null;
  role: string;
}

export interface ChatboxApiChannel {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  isActive: boolean;
  license?: {
    id?: string;
    status?: string;
    expireDate?: string;
    title?: string;
  } | null;
}

export interface ChatboxApiCustomer {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatboxApiChannelClient {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  channelType: string;
  channelId: string;
  customerId?: string | null;
  externalId?: string | null;
  isBlocked: boolean;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatboxApiChat {
  id: string;
  channelId: string;
  status: string;
  client?: { id?: string; name?: string | null; phone?: string | null } | null;
  responsible?: { id?: string; name?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatboxApiMessage {
  id: string;
  chatId: string;
  content: {
    text?: string | null;
    type: string;
    imageUrl?: string | null;
    fileUrl?: string | null;
    audioUrl?: string | null;
    videoUrl?: string | null;
  };
  sender: {
    id?: string | null;
    name?: string | null;
    type: string;
  };
  createdAt: string;
}

export interface ChatboxApiMember {
  id: string;
  email?: string | null;
  name?: string | null;
  role: string;
  createdAt: string;
}

export type ChatboxPaginated<T, K extends string> = {
  total: number;
} & { [P in K]: T[] };

type PageParams = {
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  search?: string;
};
type ChatListParams = PageParams & {
  status?: string;
};

type QueryParams = Record<string, string | number | undefined>;

export class ChatboxApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = 'ChatboxApiError';
  }
}

@Injectable()
export class ChatboxApiClient {
  private readonly logger = new Logger(ChatboxApiClient.name);
  private static readonly TIMEOUT_MS = 20_000;
  private static readonly PREFIX = '/api/v1';

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async listWorkspaces(
    token: string,
    params?: { limit?: number; offset?: number; search?: string },
  ): Promise<ChatboxPaginated<ChatboxWorkspace, 'workspaces'>> {
    return this.call<ChatboxPaginated<ChatboxWorkspace, 'workspaces'>>(
      token,
      'GET',
      '/workspaces',
      params,
    );
  }

  async listChannels(
    token: string,
    ws: string,
    params?: PageParams,
  ): Promise<ChatboxPaginated<ChatboxApiChannel, 'channels'>> {
    return this.call<ChatboxPaginated<ChatboxApiChannel, 'channels'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/channels`,
      params,
    );
  }

  async listChats(
    token: string,
    ws: string,
    params?: ChatListParams,
  ): Promise<ChatboxPaginated<ChatboxApiChat, 'chats'>> {
    return this.call<ChatboxPaginated<ChatboxApiChat, 'chats'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/chats`,
      params,
    );
  }

  async getChat(token: string, ws: string, chatId: string): Promise<ChatboxApiChat> {
    return this.call<ChatboxApiChat>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/chats/${encodeURIComponent(chatId)}`,
    );
  }

  async listMessages(
    token: string,
    ws: string,
    chatId: string,
    params?: PageParams,
  ): Promise<ChatboxPaginated<ChatboxApiMessage, 'messages'>> {
    return this.call<ChatboxPaginated<ChatboxApiMessage, 'messages'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/chats/${encodeURIComponent(chatId)}/messages`,
      params,
    );
  }

  async sendMessage(
    token: string,
    ws: string,
    chatId: string,
    body: { text: string },
  ): Promise<ChatboxApiMessage> {
    return this.call<ChatboxApiMessage>(
      token,
      'POST',
      `/workspaces/${encodeURIComponent(ws)}/chats/${encodeURIComponent(chatId)}/messages`,
      undefined,
      { text: body.text, type: 'TEXT' },
    );
  }

  async listChannelClients(
    token: string,
    ws: string,
    params?: PageParams,
  ): Promise<ChatboxPaginated<ChatboxApiChannelClient, 'clients'>> {
    return this.call<ChatboxPaginated<ChatboxApiChannelClient, 'clients'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/channel-clients`,
      params,
    );
  }

  async listCustomers(
    token: string,
    ws: string,
    params?: PageParams,
  ): Promise<ChatboxPaginated<ChatboxApiCustomer, 'customers'>> {
    return this.call<ChatboxPaginated<ChatboxApiCustomer, 'customers'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/customers`,
      params,
    );
  }

  async listMembers(
    token: string,
    ws: string,
    params?: PageParams,
  ): Promise<ChatboxPaginated<ChatboxApiMember, 'members'>> {
    return this.call<ChatboxPaginated<ChatboxApiMember, 'members'>>(
      token,
      'GET',
      `/workspaces/${encodeURIComponent(ws)}/members`,
      params,
    );
  }

  private async call<T>(
    token: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    query?: QueryParams,
    body?: unknown,
  ): Promise<T> {
    const qs = this.buildQuery(query);
    const url = `${this.cfg.chatbox.apiBaseUrl}${ChatboxApiClient.PREFIX}${path}${qs}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ChatboxApiClient.TIMEOUT_MS),
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ChatboxApiError(0, `network: ${message}`, true);
    }

    const parsed = await this.parseBody(res);

    if (!res.ok) {
      const description = extractMessage(parsed) ?? `ChatBox API ${path} → HTTP ${res.status}`;
      const transient = res.status === 429 || res.status >= 500;
      throw new ChatboxApiError(res.status, description, transient);
    }

    return (parsed ?? ({} as T)) as T;
  }

  private async parseBody(res: Response): Promise<unknown> {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    try {
      const text = await res.text();
      return text ? safeJsonParse(text) : null;
    } catch {
      return null;
    }
  }

  private buildQuery(query?: QueryParams): string {
    if (!query) return '';
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      sp.set(k, String(v));
    }
    const str = sp.toString();
    return str ? `?${str}` : '';
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['message'] === 'string') return obj['message'];
  if (Array.isArray(obj['message']) && typeof obj['message'][0] === 'string') {
    return obj['message'].join('; ');
  }
  if (typeof obj['error'] === 'string') return obj['error'];
  return null;
}
