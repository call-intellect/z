import { useCallback, useEffect, useState } from "react";

import {
  threadsApi,
  type InboxSort,
  type InboxThreadType,
} from "@/api/threads.api";
import { inboxThreadFromApi, type InboxThread } from "@/domain/messaging";
import { ApiError } from "@/api/error";

interface State {
  threads: InboxThread[];
  loading: boolean;
  error: string | null;
}

export function useThreads(type: InboxThreadType, sort: InboxSort, q: string) {
  const [state, setState] = useState<State>({
    threads: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await threadsApi.list({
        type,
        sort,
        q: q.trim() || null,
      });
      setState({
        threads: res.items.map(inboxThreadFromApi),
        loading: false,
        error: null,
      });
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : "Не удалось загрузить ленту";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [type, sort, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}

export function useUnreadCount() {
  const [total, setTotal] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await threadsApi.unreadCount();
      setTotal(res.total);
    } catch {
      // keep previous value on error
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return { total, refresh };
}
