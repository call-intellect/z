'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { ArrowLeft, Contact, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { chatboxApi } from '@/api/chatbox.api';
import { personsApi } from '@/api/persons.api';
import {
  chatboxLinkModeBadgeVariant,
  mapCustomer,
  type ChatboxCustomerView,
} from '@/domain/chatbox';
import { useAuth } from '@/contexts/auth-context';
import { TierGate } from '@/ui/components/TierGate';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

/**
 * `/chats/integrations/chatbox/customers` — ручной маппинг клиентов Чат бокса
 * на сотрудников (Person) Коры. ТЗ 2026-06-11 chatbox-memory-finishing, Ф1.
 * Клон экрана менеджеров (`../managers`).
 *
 * Контракт: `GET /chatbox/customers`, `PUT /chatbox/customers/:id/link`,
 * `POST /chatbox/customers/:id/create-person`.
 * Список сотрудников для пикера — `personsApi.list` (type=person).
 */

const NONE_VALUE = '__none__';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
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
  } = useSWR(['chatbox-customers'], () =>
    chatboxApi.listCustomers().then((list) => list.map(mapCustomer)),
  );

  const { data: persons } = useSWR(
    currentOrgId ? ['org-persons', currentOrgId] : null,
    () => personsApi.list(currentOrgId!, { limit: 200 }),
  );

  // Эндпоинт /persons отдаёт person-card (`name`), а типизирован как entity
  // (`canonicalName`) — берём реальный `name` с фолбэком, чтобы опции не были
  // пустыми (иначе клиента не с кем связать).
  const personOptions: { id: string; name: string }[] = (
    persons?.items ?? []
  ).map((p) => {
    const raw = p as unknown as { name?: string; canonicalName?: string };
    return { id: p.id, name: raw.name ?? raw.canonicalName ?? '(без имени)' };
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
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
              Клиенты и сотрудники
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
          {errMessage(customersError, 'Не удалось загрузить клиентов')}
        </div>
      )}

      {!customersLoading &&
        !customersError &&
        customers &&
        customers.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-fg-secondary">
                Клиентов нет — синхронизируйте их на{' '}
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

      {!customersLoading &&
        !customersError &&
        customers &&
        customers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Клиенты ({customers.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  personOptions={personOptions}
                  onLinked={() => void mutate()}
                />
              ))}
            </CardContent>
          </Card>
        )}
    </div>
  );
}

function CustomerRow({
  customer,
  personOptions,
  onLinked,
}: {
  customer: ChatboxCustomerView;
  personOptions: { id: string; name: string }[];
  onLinked: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await chatboxApi.createCustomerPerson(customer.id);
      toast.success('Сотрудник создан и связан');
      onLinked();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.code === 'chatbox_customer_already_linked'
      ) {
        toast.error('Клиент уже связан с сотрудником');
      } else {
        toast.error(errMessage(e, 'Не удалось создать сотрудника'));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleChange = async (value: string) => {
    const personId = value === NONE_VALUE ? null : value;
    setSaving(true);
    try {
      await chatboxApi.linkCustomer(customer.id, personId);
      toast.success('Связь обновлена');
      onLinked();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chatbox_customer_not_found') {
        toast.error('Клиент не найден');
      } else if (e instanceof ApiError && e.code === 'person_not_found') {
        toast.error('Сотрудник не найден');
      } else {
        toast.error(errMessage(e, 'Не удалось обновить связь'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">
            {customer.displayName}
          </span>
          <Badge variant={chatboxLinkModeBadgeVariant(customer.linkMode)}>
            {customer.linkModeLabel}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {customer.email ?? customer.phone ?? '—'}
        </div>
        {customer.linkedPersonName && (
          <div className="mt-0.5 truncate text-xs text-fg-secondary">
            Сотрудник: {customer.linkedPersonName}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
        <div className="flex items-center gap-2">
          <Select
            value={customer.linkedPersonId ?? NONE_VALUE}
            onValueChange={(v) => void handleChange(v)}
            disabled={saving || creating}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Выберите сотрудника" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>— Не связан —</SelectItem>
              {personOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {saving && (
            <Loader2 size={16} className="animate-spin text-fg-tertiary" />
          )}
        </div>

        {!customer.linkedPersonId && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={saving || creating}
            title="Создать сотрудника компании на основе этого клиента и связать"
          >
            {creating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
            Создать сотрудника
          </Button>
        )}
      </div>
    </div>
  );
}
