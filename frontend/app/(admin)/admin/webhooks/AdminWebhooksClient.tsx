"use client";

import { useState } from "react";
import { Webhook, Send, Loader2 } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { Badge } from "@/ui/shadcn/badge";
import { useAuth } from "@/contexts/auth-context";
import { useWebhooks } from "@/hooks/tracker/useWebhooks";
import { webhooksApi } from "@/api/tracker/webhooks.api";

export function AdminWebhooksClient() {
  const { currentOrgId } = useAuth();
  const { webhooks, isLoading, error, mutate } = useWebhooks(currentOrgId);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleTest = async (id: string) => {
    if (!currentOrgId) return;
    setTestingId(id);
    try {
      await webhooksApi.test(currentOrgId, id);
      await mutate();
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
          <Webhook size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Авто-уведомления другой системе
          </h1>
          <p className="text-sm text-fg-tertiary">
            Webhook’и трекера — отправка событий по HTTPS
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить webhook’и.
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
          Авто-уведомлений пока нет. Создание появится в Sprint 3.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {webhooks.map((w) => (
            <li
              key={w.id}
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 md:flex-row md:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg-primary">
                    {w.name}
                  </span>
                  {w.isActive ? (
                    <Badge variant="success">Активен</Badge>
                  ) : (
                    <Badge variant="secondary">Выключен</Badge>
                  )}
                  {w.isInternal && <Badge variant="outline">Внутренний</Badge>}
                </div>
                <div className="truncate text-xs text-fg-tertiary">{w.url}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {w.events.map((ev) => (
                    <Badge key={ev} variant="outline" className="font-mono">
                      {ev}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleTest(w.id)}
                disabled={testingId === w.id}
                className="gap-2"
              >
                {testingId === w.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Тестовая отправка
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
