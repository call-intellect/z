import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

import type { MessageAccessApi } from "./threads.api";
import { threadsApi } from "./threads.api";

const OUTBOX_KEY = "kora.outbox.v1";

export interface OutboxItem {
  conversationId: string;
  content: string;
  clientMessageId: string;
  access?: MessageAccessApi;
  createdAt: number;
}

let flushing = false;

async function readAll(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export async function enqueue(item: OutboxItem): Promise<void> {
  const items = await readAll();
  if (items.some((i) => i.clientMessageId === item.clientMessageId)) return;
  items.push(item);
  await writeAll(items);
}

export async function pendingCount(): Promise<number> {
  return (await readAll()).length;
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  const state = await NetInfo.fetch();
  if (state.isConnected === false) return;

  flushing = true;
  try {
    let items = await readAll();
    const remaining: OutboxItem[] = [];
    for (const item of items) {
      try {
        await threadsApi.sendMessage(item.conversationId, {
          content: item.content,
          clientMessageId: item.clientMessageId,
          ...(item.access ? { access: item.access } : {}),
        });
      } catch {
        remaining.push(item);
      }
    }
    items = remaining;
    await writeAll(items);
  } finally {
    flushing = false;
  }
}

export function startOutboxAutoFlush(): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      void flushOutbox();
    }
  });
  return unsubscribe;
}
