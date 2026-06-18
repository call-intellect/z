"use client";

import { useEffect, useState } from "react";

import { useMyCloneAccess } from "./useClones";

const LAST_SEEN_LS_KEY = "clones:last-seen-grants-iso";
const LAST_SEEN_COUNT_LS_KEY = "clones:last-seen-grants-count";

export function useUnseenCloneGrants(orgId: string | null): boolean {
  const { access } = useMyCloneAccess(orgId);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    if (!access) {
      setHasUnseen(false);
      return;
    }
    if (typeof window === "undefined") return;
    const totalCount = access.roleClones.size + access.personClones.size;
    if (totalCount === 0) {
      setHasUnseen(false);
      return;
    }
    let lastSeenCount = 0;
    try {
      const raw = window.localStorage.getItem(LAST_SEEN_COUNT_LS_KEY);
      lastSeenCount = raw ? Number(raw) : 0;
      if (!Number.isFinite(lastSeenCount)) lastSeenCount = 0;
    } catch {
      lastSeenCount = 0;
    }
    setHasUnseen(totalCount > lastSeenCount);
  }, [access]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSeen = () => {
      if (!access) return;
      try {
        const totalCount = access.roleClones.size + access.personClones.size;
        window.localStorage.setItem(LAST_SEEN_COUNT_LS_KEY, String(totalCount));
        window.localStorage.setItem(LAST_SEEN_LS_KEY, new Date().toISOString());
      } catch {}
      setHasUnseen(false);
    };
    window.addEventListener("clones:grants-seen", onSeen);
    return () => window.removeEventListener("clones:grants-seen", onSeen);
  }, [access]);

  return hasUnseen;
}
