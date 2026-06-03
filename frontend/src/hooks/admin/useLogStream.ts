'use client';

/**
 * useLogStream — live-стрим технических логов по WebSocket (`/ws/platform-logs`).
 *
 * Backend: `backend/src/modules/logging/log-stream.gateway.ts` (Socket.IO,
 * только super_admin). Событие `logs` — массив `SystemLogRecordApi`, пушится
 * после каждого flush'а буфера в БД. Заменяет поллинг в `/admin/logs`.
 *
 * Контракт: `withCredentials: true` (cookie `z_session`); подключение только
 * при `enabled`. Хендлер хранится в ref — не пересоздаёт соединение на каждый
 * рендер. Reconnect/heartbeat — встроенные в socket.io.
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type { SystemLogRecordApi } from '@/domain/system-logs';

function resolveWsUrl(): string {
  const ns = '/ws/platform-logs';
  const wsEnv = typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_WS_URL ?? '').trim();
  if (wsEnv) return wsEnv.replace(/\/+$/, '') + ns;
  const apiEnv =
    typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim();
  if (apiEnv) return apiEnv.replace(/\/+$/, '') + ns;
  if (typeof window !== 'undefined') return window.location.origin + ns;
  return ns;
}

export function useLogStream(
  enabled: boolean,
  onLogs: (logs: SystemLogRecordApi[]) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onLogs);
  handlerRef.current = onLogs;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setConnected(false);
      return;
    }
    const socket: Socket = io(resolveWsUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: Error) => {
      console.warn('[logs-ws] connect_error:', err.message);
    });
    socket.on('logs', (payload: unknown) => {
      if (Array.isArray(payload)) {
        handlerRef.current(payload as SystemLogRecordApi[]);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
