"use client";

import { useEffect } from "react";
import { mutate as swrMutate } from "swr";

import type { TrackerWsEventType } from "@/domain/tracker";

import { useTrackerWebSocket } from "./useTrackerWebSocket";

const REFRESH_DEBOUNCE_MS = 150;

export interface TrackerLiveRefreshOptions {
  projectId?: string | null;
  issueId?: string | null;
}

export function useTrackerLiveRefresh(
  orgId: string | null | undefined,
  options: TrackerLiveRefreshOptions = {},
  enabled: boolean = true,
): { connected: boolean } {
  const { client, connected } = useTrackerWebSocket(orgId, enabled);
  const { projectId, issueId } = options;

  useEffect(() => {
    if (!client || !projectId) return;
    void client.subscribeProject(projectId);
    return () => {
      void client.unsubscribeProject(projectId);
    };
  }, [client, projectId]);

  useEffect(() => {
    if (!client || !issueId) return;
    void client.subscribeIssue(issueId);
    return () => {
      void client.unsubscribeIssue(issueId);
    };
  }, [client, issueId]);

  useEffect(() => {
    if (!client) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const refreshDebounced = (keyPrefix: string): void => {
      const existing = timers.get(keyPrefix);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(keyPrefix);
        void swrMutate(
          (key: unknown) =>
            Array.isArray(key) &&
            typeof key[0] === "string" &&
            key[0] === keyPrefix,
          undefined,
          { revalidate: true },
        );
      }, REFRESH_DEBOUNCE_MS);
      timers.set(keyPrefix, t);
    };

    const handlers: Array<() => void> = [];

    const subscribe = (
      eventType: TrackerWsEventType,
      keyPrefixes: string[],
    ): void => {
      const off = client.on(eventType, () => {
        for (const prefix of keyPrefixes) refreshDebounced(prefix);
      });
      handlers.push(off);
    };

    subscribe("issue.created", [
      "tracker.issues",
      "tracker.issue.children",
      "me.inbox",
    ]);
    subscribe("issue.updated", [
      "tracker.issues",
      "tracker.issue",
      "tracker.issue.activity",
      "tracker.issue.children",
      "me.inbox",
    ]);
    subscribe("issue.deleted", [
      "tracker.issues",
      "tracker.issue",
      "tracker.issue.children",
      "me.inbox",
    ]);

    subscribe("comment.created", [
      "tracker.issue.comments",
      "tracker.issue.activity",
    ]);
    subscribe("comment.updated", ["tracker.issue.comments"]);
    subscribe("comment.deleted", [
      "tracker.issue.comments",
      "tracker.issue.activity",
    ]);

    subscribe("cycle.created", ["tracker.cycles"]);
    subscribe("cycle.progress_updated", ["tracker.cycles", "tracker.cycle"]);
    subscribe("cycle.completed", ["tracker.cycles", "tracker.cycle"]);

    subscribe("intake.new_item", ["tracker.intake"]);
    subscribe("intake.triaged", [
      "tracker.intake",
      "tracker.issues",
      "me.inbox",
    ]);

    subscribe("activity_feed.new_item", ["tracker.activity-feed"]);

    return () => {
      for (const off of handlers) off();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [client]);

  return { connected };
}
