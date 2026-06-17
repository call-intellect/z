"use client";

import { useRoomContext } from "@livekit/components-react";
import type { Room } from "livekit-client";

export function useLivekitRoom(): Room {
  return useRoomContext();
}
