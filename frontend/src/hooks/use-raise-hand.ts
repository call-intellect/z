'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { ParticipantEvent, RoomEvent, type Participant } from 'livekit-client';

const ATTR_RAISED = 'hand_raised';
const ATTR_RAISED_AT = 'hand_raised_at';

export type RaiseHandState = {
  isRaised: boolean;
  raisedAt: Date | null;
  toggle: () => Promise<void>;
};

function readState(participant: Participant): { isRaised: boolean; raisedAt: Date | null } {
  const attrs = participant.attributes ?? {};
  const isRaised = attrs[ATTR_RAISED] === 'true';
  const raw = attrs[ATTR_RAISED_AT];
  const raisedAt = raw ? new Date(raw) : null;
  return {
    isRaised,
    raisedAt: raisedAt && !Number.isNaN(raisedAt.getTime()) ? raisedAt : null,
  };
}

/**
 * Хук raise-hand для локального участника.
 * Хранение — в `participant.attributes` (LiveKit). Чтение — для всех остальных
 * участников через `participant.attributes` напрямую (см. `ParticipantsPanel`).
 */
export function useRaiseHand(): RaiseHandState {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [state, setState] = useState(() => readState(localParticipant));

  useEffect(() => {
    const sync = () => setState(readState(localParticipant));

    // Локальные изменения наших же attributes (мы их меняем через setAttributes).
    localParticipant.on(ParticipantEvent.AttributesChanged, sync);
    // На некоторых сборках LiveKit изменения локальных attrs прилетают через room.
    room.on(RoomEvent.ParticipantAttributesChanged, sync);

    return () => {
      localParticipant.off(ParticipantEvent.AttributesChanged, sync);
      room.off(RoomEvent.ParticipantAttributesChanged, sync);
    };
  }, [localParticipant, room]);

  const toggle = useCallback(async () => {
    const next = !state.isRaised;
    await localParticipant.setAttributes({
      [ATTR_RAISED]: next ? 'true' : 'false',
      [ATTR_RAISED_AT]: next ? new Date().toISOString() : '',
    });
    setState({
      isRaised: next,
      raisedAt: next ? new Date() : null,
    });
  }, [localParticipant, state.isRaised]);

  return { ...state, toggle };
}

/**
 * Извлечь raise-hand состояние любого участника. Чистая функция, без хуков —
 * вызывающий должен сам подписаться на изменения через `useParticipants` или
 * `RoomEvent.ParticipantAttributesChanged`.
 */
export function readRaiseHand(p: Participant): {
  isRaised: boolean;
  raisedAt: Date | null;
} {
  return readState(p);
}
