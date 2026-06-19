"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Contact, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { chatboxApi } from "@/api/chatbox.api";
import { personsDomainApi } from "@/api/structure.api";
import {
  chatboxLinkModeBadgeVariant,
  mapCustomer,
  type ChatboxCustomerView,
} from "@/domain/chatbox";
import { useAuth } from "@/contexts/auth-context";
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

function currentValue(customer: ChatboxCustomerView): string {
  return customer.linkedPersonId ?? NONE_VALUE;
}

type PersonOption = { id: string; name: string; email: string | null };

function MatchCell({
  value,
  sourceEmail,
  options,
}: {
  value: string;
  sourceEmail: string | null;
  options: PersonOption[];
}) {
  if (value === NONE_VALUE) {
    return <span className="text-sm text-fg-tertiary">— Не связывать —</span>;
  }
  if (value === CREATE_VALUE) {
    return (
      <span className="text-sm font-medium text-accent">
        ＋ Создать нового клиента
      </span>
    );
  }
  const person = options.find((p) => p.id === value);
  const isEmailMatch =
    person?.email &&
    sourceEmail &&
    person.email.toLowerCase() === sourceEmail.toLowerCase();
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium text-fg-primary">
          {person?.name || "(без имени)"}
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

export function ChatboxCustomersClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxCustomersContent />
    </TierGate>
  );
}

function ChatboxCustomersContent() {
  const { currentOrgId } = useAuth();

  const {
    data: customers,
    error: customersError,
    isLoading: customersLoading,
    mutate,
  } = useSWR(["chatbox-customers"], () =>
    chatboxApi.listCustomers().then((list) => list.map(mapCustomer)),
  );

  const { data: persons } = useSWR(
    currentOrgId ? ["org-persons-external", currentOrgId] : null,
    () => personsDomainApi.list(currentOrgId!, { relationship: "external" }),
  );

  const personOptions: PersonOption[] = (persons?.items ?? []).map((p) => ({
    id: p.id,
    name: p.fullName || "(без имени)",
    email: p.email ?? null,
  }));

  const [pending, setPending] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const suggestionsApplied = useRef(false);

  useEffect(() => {
    if (!customers || !persons || suggestionsApplied.current) return;
    suggestionsApplied.current = true;
    const suggestions: Record<string, string> = {};
    for (const c of customers) {
      if (c.linkedPersonId) continue;
      const match = (persons.items ?? []).find(
        (p) =>
          p.email &&
          c.email &&
          p.email.toLowerCase() === c.email.toLowerCase(),
      );
      suggestions[c.id] = match ? match.id : CREATE_VALUE;
    }
    if (Object.keys(suggestions).length > 0) setPending(suggestions);
  }, [customers, persons]);

  const list = customers ?? [];
  const changed = list.filter((c) => {
    const v = pending[c.id];
    return v !== undefined && v !== currentValue(c);
  });

  const handleApply = async () => {
    setApplying(true);
    let ok = 0;
    for (const c of changed) {
      const v = pending[c.id];
      try {
        if (v === CREATE_VALUE) {
          await chatboxApi.createCustomerPerson(c.id);
        } else {
          await chatboxApi.linkCustomer(c.id, v === NONE_VALUE ? null : v);
        }
        ok += 1;
      } catch (e) {
        toast.error(errMessage(e, `Не удалось обновить связь: ${c.displayName}`));
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
          href="/chats/integrations/chatbox"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft size={14} /> К интеграции
        </Link>
        <div className="flex items-center gap-2">
          <Contact size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Клиенты
            </h1>
            <p className="text-sm text-fg-secondary">
              Свяжите клиентов Чат бокса с карточками людей компании, чтобы Кора
              верно приписывала знания из переписок.
            </p>
          </div>
        </div>
      </header>

      {customersLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {customersError && !customersLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(customersError, "Не удалось загрузить клиентов")}
        </div>
      )}

      {!customersLoading && !customersError && list.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-fg-secondary">
              Клиентов нет — нажмите «Получить клиентов» на{" "}
              <Link
                href="/chats/integrations/chatbox"
                className="text-accent hover:underline"
              >
                странице интеграции
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {!customersLoading && !customersError && list.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Клиенты ({list.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 hidden grid-cols-[2fr_2fr_1.5fr] gap-4 px-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary sm:grid">
              <span>Из Чат бокса</span>
              <span>Предложение</span>
              <span>Действие</span>
            </div>
            <div className="space-y-2">
              {list.map((customer) => {
                const value = pending[customer.id] ?? currentValue(customer);
                return (
                  <CustomerRow
                    key={customer.id}
                    customer={customer}
                    personOptions={personOptions}
                    value={value}
                    dirty={value !== currentValue(customer)}
                    disabled={applying}
                    onChange={(v) =>
                      setPending((p) => ({ ...p, [customer.id]: v }))
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

function CustomerRow({
  customer,
  personOptions,
  value,
  dirty,
  disabled,
  onChange,
}: {
  customer: ChatboxCustomerView;
  personOptions: PersonOption[];
  value: string;
  dirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const allOptions: PersonOption[] =
    customer.linkedPersonId &&
    !personOptions.some((p) => p.id === customer.linkedPersonId)
      ? [
          {
            id: customer.linkedPersonId,
            name: customer.linkedPersonName ?? "(без имени)",
            email: null,
          },
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
            {customer.displayName}
          </span>
          <Badge variant={chatboxLinkModeBadgeVariant(customer.linkMode)}>
            {customer.linkModeLabel}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {customer.email ?? customer.phone ?? "—"}
        </div>
      </div>

      <div className="flex min-w-0 items-center">
        <MatchCell
          value={value}
          sourceEmail={customer.email}
          options={allOptions}
        />
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
                {p.name}
              </SelectItem>
            ))}
            <SelectItem value={CREATE_VALUE}>
              ＋ Создать нового клиента
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
