"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Loader2, Save } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  listMyChannels,
  updateBindingPreferences,
} from "@/api/me-channels.api";
import {
  buildTelegramPreferencesPayload,
  mapTelegramChannelEntry,
  TELEGRAM_DEFAULT_ALLOW,
  TELEGRAM_DEFAULT_QUIET_HOURS,
  TELEGRAM_NOTIFICATION_OPTIONS,
  type TelegramChannelPreferences,
  type TelegramNotificationKey,
  type TelegramQuietHours,
} from "@/domain/me-channels";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Checkbox } from "@/ui/shadcn/checkbox";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import { Skeleton } from "@/ui/shadcn/skeleton";

const GROUP_LABELS = {
  inbox: "Что присылать в Telegram",
  digest: "Сводки",
  team: "События команды",
} as const;

export function NotificationsTelegramClient() {
  const { currentOrgId, isLoading } = useAuth();
  const swrKey = currentOrgId ? ["my-channels", currentOrgId] : null;
  const {
    data,
    error,
    isLoading: loadingList,
  } = useSWR(swrKey, async () => {
    const res = await listMyChannels(currentOrgId!);
    return res.items;
  });

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-muted-foreground">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  if (loadingList) {
    return (
      <section className="container mx-auto max-w-2xl space-y-4 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  if (error instanceof Error) {
    return (
      <section className="container mx-auto max-w-2xl p-6">
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm">
          Не удалось загрузить настройки: {error.message}
        </div>
      </section>
    );
  }

  const tgEntry = (data ?? []).find((e) => e.channel.kind === "telegram_bot");
  const view = tgEntry ? mapTelegramChannelEntry(tgEntry) : null;

  return (
    <section className="container mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Уведомления в Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Что Кора может присылать вам в Telegram-бот. Если что-то отключено —
          оно всё равно появится во «Входящих» в личном кабинете.
        </p>
      </header>

      {!view || !view.binding ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-sm">
            <p className="text-muted-foreground">
              Telegram-бот ещё не привязан к вашему аккаунту. Сначала привяжите
              его на странице{" "}
              <Link href="/me/channels" className="underline">
                «Мои каналы»
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <PreferencesForm
          bindingId={view.binding.id}
          initial={view.binding.preferences}
          onSaved={() => mutate(swrKey)}
        />
      )}
    </section>
  );
}

function PreferencesForm({
  bindingId,
  initial,
  onSaved,
}: {
  bindingId: string;
  initial: TelegramChannelPreferences;
  onSaved: () => Promise<unknown> | void;
}) {
  const initialAllow = useMemo<TelegramNotificationKey[]>(
    () =>
      initial.allow.length > 0
        ? [...initial.allow]
        : [...TELEGRAM_DEFAULT_ALLOW],
    [initial.allow],
  );

  const [allow, setAllow] = useState<Set<TelegramNotificationKey>>(
    () => new Set(initialAllow),
  );
  const [quietHours, setQuietHours] = useState<TelegramQuietHours>(
    initial.quietHours ?? TELEGRAM_DEFAULT_QUIET_HOURS,
  );
  const [busy, setBusy] = useState(false);

  function toggle(k: TelegramNotificationKey, checked: boolean) {
    setAllow((prev) => {
      const next = new Set(prev);
      if (checked) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    try {
      await updateBindingPreferences(
        bindingId,
        buildTelegramPreferencesPayload({
          allow: Array.from(allow),
          quietHours,
          disabledUntilIso: initial.disabledUntilIso,
        }),
      );
      toast.success("Настройки сохранены.");
      await onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(
          `Не удалось сохранить: ${humanizeApiError(e, "попробуйте ещё раз")}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const groups = (["inbox", "digest", "team"] as const).map((g) => ({
    key: g,
    label: GROUP_LABELS[g],
    options: TELEGRAM_NOTIFICATION_OPTIONS.filter((o) => o.group === g),
  }));

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {group.options.map((opt) => (
              <label
                key={opt.key}
                className="flex cursor-pointer items-start gap-3"
              >
                <Checkbox
                  checked={allow.has(opt.key)}
                  onCheckedChange={(c) => toggle(opt.key, c === true)}
                  className="mt-0.5"
                />
                <div>
                  <div>{opt.label}</div>
                  {opt.hint && (
                    <div className="text-xs text-muted-foreground">
                      {opt.hint}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Тихие часы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            В это окно Telegram-бот молчит. Срочные сообщения, если включён
            переключатель ниже, всё равно отправятся.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="quiet-start">С</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietHours.start}
                onChange={(e) =>
                  setQuietHours((p) => ({ ...p, start: e.target.value }))
                }
                className="w-32"
              />
            </div>
            <div>
              <Label htmlFor="quiet-end">По</Label>
              <Input
                id="quiet-end"
                type="time"
                value={quietHours.end}
                onChange={(e) =>
                  setQuietHours((p) => ({ ...p, end: e.target.value }))
                }
                className="w-32"
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={quietHours.allowCritical}
              onCheckedChange={(c) =>
                setQuietHours((p) => ({ ...p, allowCritical: c === true }))
              }
            />
            <span>Срочные сообщения всё равно слать</span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}
