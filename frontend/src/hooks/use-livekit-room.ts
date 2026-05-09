'use client';

import { useRoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';

/**
 * Тонкая обёртка над `useRoomContext()` — чтобы у нас был один точечный импорт
 * комнаты в нашем коде. Сама обёртка не делает ничего сверх — `LiveKitRoom`
 * провайдит контекст, мы его читаем.
 */
export function useLivekitRoom(): Room {
  return useRoomContext();
}
