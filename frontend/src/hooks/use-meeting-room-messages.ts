"use client";

import useSWR from "swr";
import { useMemo } from "react";

import { roomMessagesApi } from "@/api/room-messages.api";
import {
  roomMessageFromApi,
  type RoomMessageDomain,
} from "@/domain/room-message";

export function useMeetingRoomMessages(meetingId: string | null | undefined) {
  const swr = useSWR(
    meetingId ? ["room-messages", meetingId] : null,
    async () => {
      if (!meetingId) return [];
      return roomMessagesApi.history(meetingId);
    },
    { revalidateOnFocus: false },
  );

  const messages: RoomMessageDomain[] = useMemo(
    () => (swr.data ?? []).map((m) => roomMessageFromApi(m)),
    [swr.data],
  );

  return {
    messages,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}
