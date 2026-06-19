"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import {
  bitrixApi,
  type BitrixPersonOptionApi,
  type BitrixUserApi,
} from "@/api/bitrix.api";
import { bitrixLinkModeLabel } from "@/domain/bitrix";
import { TierGate } from "@/ui/components/TierGate";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

const NONE_VALUE = "__none__";
const CREATE_VALUE = "__create__";

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function linkModeBadgeVariant(
  mode: BitrixUserApi["linkMode"],
): "default" | "secondary" | "outline" {
  if (mode === "manual") return "default";
  if (mode === "auto") return "secondary";
  return "outline";
}

function currentValue(user: BitrixUserApi): string {
  return user.linkedPersonId ?? NONE_VALUE;
}

type PersonOption = { id: string; name: string | null; email: string | null };

function MatchCell({
  value,
  userEmail,
  options,
}: {
  value: string;
  userEmail: string | null;
  options: PersonOption[];
}) {
  if (value === NONE_VALUE) {
    return <span className="text-sm text-fg-tertiary">— Не связывать —</span>;
  }
  if (value === CREATE_VALUE) {
    return (
      <span className="text-sm font-medium text-accent">
        ＋ Создать нового сотрудника
      </span>
    );
  }
  const person = options.find((p) => p.id === value);
  const isEmailMatch =
    person?.email &&
    userEmail &&
    person.email.toLowerCase() === userEmail.toLowerCase();
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium text-fg-primary">
          {person?.name?.trim() || person?.email || "(без имени)"}
        </span>
        {isEmailMatch && (
          <Badge variant="secondary" className="shrink-0 text-xs">
            по email
          </Badge>
        )}
      </div>
      {person?.email && (
        <div className="truncate text-xs text-fg-tertiary">{person.email}</div>
      )}
    </div>
  );
}

export function BitrixManagersClient() {
  return (
    <TierGate feature="feature.bitrix">
      <BitrixManagersContent />
    </TierGate>
  );
}

function BitrixManagersContent() {
  const { data, error, isLoading, mutate } = useSWR(["bitrix-users"], () =>
    bitrixApi.listUsers(),
  );

  const users = data?.users ?? [];
  const personOptions = data?.personCandidates ?? [];

  const [pending, setPending] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const suggestionsApplied = useRef(false);

  useEffect(() => {
    if (!data || suggestionsApplied.current) return;
    suggestionsApplied.current = true;
    const suggestions: Record<string, string> = {};
    for (const user of data.users) {
      if (user.linkedPersonId) continue;
      const match = data.personCandidates.find(
        (p) =>
          p.email &&
          user.email &&
          p.email.toLowerCase() === user.email.toLowerCase(),
      );
      suggestions[user.externalId] = match ? match.id : CREATE_VALUE;
    }
    if (Object.keys(suggestions).length > 0) setPending(suggestions);
  }, [data]);

  const changed = users.filter((u) => {
    const v = pending[u.externalId];
    return v !== undefined && v !== currentValue(u);
  });

  const handleApply = async () => {
    setApplying(true);
    let ok = 0;
    for (const u of changed) {
      const v = pending[u.externalId];
      try {
        if (v === CREATE_VALUE) {
          await bitrixApi.linkUser(u.externalId, "create");
        } else if (v === NONE_VALUE) {
          await bitrixApi.linkUser(u.externalId, "unlink");
        } else {
          await bitrixApi.linkUser(u.externalId, "link", v);
        }
        ok += 1;
      } catch (e) {
        toast.error(
          errMessage(e, `Не удалось обновить связь: ${u.name ?? u.externalId}`),
        );
      }
    }
    if (ok > 0) toast.success(`Сопоставление применено: ${ok}`);
    suggestionsApplied.current = false;
    setPending({});
    await mutate();
    setApplying(false);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/company-admin/sources/bitrix"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft size={14} /> К интеграции
        </Link>
        <div className="flex items-center gap-2">
          <Users size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Сотрудники Bitrix24
            </h1>
            <p className="text-sm text-fg-secondary">
              Свяжите сотрудников портала с людьми компании, чтобы Кора верно
              приписывала знания из внутренних переписок.
            </p>
          </div>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(error, "Не удалось загрузить сотрудников")}
        </div>
      )}

      {!isLoading && !error && users.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-fg-secondary">
              Сотрудников нет — нажмите «Получить сотрудников» на{" "}
              <Link
                href="/company-admin/sources/bitrix"
                className="text-accent hover:underline"
              >
                странице интеграции
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && users.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Сотрудники ({users.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 hidden grid-cols-[2fr_2fr_1.5fr] gap-4 px-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary sm:grid">
              <span>Из Bitrix24</span>
              <span>Предложение</span>
              <span>Действие</span>
            </div>
            <div className="space-y-2">
              {users.map((user) => {
                const value = pending[user.externalId] ?? currentValue(user);
                return (
                  <UserRow
                    key={user.externalId}
                    user={user}
                    personOptions={personOptions}
                    value={value}
                    dirty={value !== currentValue(user)}
                    disabled={applying}
                    onChange={(v) =>
                      setPending((p) => ({ ...p, [user.externalId]: v }))
                    }
                  />
                );
              })}
              <ApplyBar
                count={changed.length}
                applying={applying}
                onApply={() => void handleApply()}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ApplyBar({
  count,
  applying,
  onApply,
}: {
  count: number;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="sticky bottom-0 -mx-3 -mb-3 mt-1 flex items-center justify-between gap-3 border-t border-border-subtle bg-bg-card/95 px-3 py-3 backdrop-blur">
      <span className="text-xs text-fg-tertiary">
        {count > 0
          ? `Несохранённых изменений: ${count}`
          : "Выберите сопоставление — изменения применятся по кнопке"}
      </span>
      <Button onClick={onApply} disabled={applying || count === 0} size="sm">
        {applying && <Loader2 size={14} className="animate-spin" />}
        Применить{count > 0 ? ` (${count})` : ""}
      </Button>
    </div>
  );
}

function UserRow({
  user,
  personOptions,
  value,
  dirty,
  disabled,
  onChange,
}: {
  user: BitrixUserApi;
  personOptions: BitrixPersonOptionApi[];
  value: string;
  dirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const displayName = user.name?.trim() || user.email || user.externalId;

  const allOptions: PersonOption[] =
    user.linkedPersonId && !personOptions.some((p) => p.id === user.linkedPersonId)
      ? [
          { id: user.linkedPersonId, name: user.linkedPersonName, email: null },
          ...personOptions,
        ]
      : personOptions;

  return (
    <div
      className={`grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_2fr_1.5fr] sm:gap-4 sm:items-center ${
        dirty
          ? "border-accent/40 bg-accent/5"
          : "border-border-subtle bg-bg-card"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-fg-primary">
            {displayName}
          </span>
          <Badge variant={linkModeBadgeVariant(user.linkMode)}>
            {bitrixLinkModeLabel(user.linkMode)}
          </Badge>
          {!user.active && (
            <Badge variant="outline" className="text-fg-tertiary">
              неактивен
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {user.email ?? "—"}
          {user.position ? ` · ${user.position}` : ""}
        </div>
      </div>

      <div className="flex min-w-0 items-center">
        <MatchCell value={value} userEmail={user.email} options={allOptions} />
      </div>

      <div className="flex items-center">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Выбрать действие" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Не связывать —</SelectItem>
            {allOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name?.trim() || p.email || "(без имени)"}
              </SelectItem>
            ))}
            <SelectItem value={CREATE_VALUE}>
              ＋ Создать нового сотрудника
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
