"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { chatboxApi } from "@/api/chatbox.api";
import { personsDomainApi } from "@/api/structure.api";
import {
  chatboxLinkModeBadgeVariant,
  mapMember,
  type ChatboxMemberView,
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

function currentValue(member: ChatboxMemberView): string {
  return member.linkedPersonId ?? NONE_VALUE;
}

export function ChatboxManagersClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxManagersContent />
    </TierGate>
  );
}

function ChatboxManagersContent() {
  const { currentOrgId } = useAuth();

  const {
    data: members,
    error: membersError,
    isLoading: membersLoading,
    mutate,
  } = useSWR(["chatbox-members"], () =>
    chatboxApi.listMembers().then((list) => list.map(mapMember)),
  );

  const { data: persons } = useSWR(
    currentOrgId ? ["org-persons-employees", currentOrgId] : null,
    () => personsDomainApi.list(currentOrgId!, { relationship: "employee" }),
  );

  const personOptions: { id: string; name: string }[] = (
    persons?.items ?? []
  ).map((p) => ({ id: p.id, name: p.fullName || "(без имени)" }));

  const [pending, setPending] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

  const list = members ?? [];
  const changed = list.filter((m) => {
    const v = pending[m.id];
    return v !== undefined && v !== currentValue(m);
  });

  const handleApply = async () => {
    setApplying(true);
    let ok = 0;
    for (const m of changed) {
      const v = pending[m.id];
      try {
        if (v === CREATE_VALUE) {
          await chatboxApi.createMemberPerson(m.id);
        } else {
          await chatboxApi.linkMember(m.id, v === NONE_VALUE ? null : v);
        }
        ok += 1;
      } catch (e) {
        toast.error(
          errMessage(e, `Не удалось обновить связь: ${m.displayName}`),
        );
      }
    }
    if (ok > 0) toast.success(`Сопоставление применено: ${ok}`);
    setPending({});
    await mutate();
    setApplying(false);
  };

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
          <Users size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Менеджеры и сотрудники
            </h1>
            <p className="text-sm text-fg-secondary">
              Свяжите менеджеров Чат бокса с сотрудниками компании, чтобы Кора
              верно приписывала знания из переписок.
            </p>
          </div>
        </div>
      </header>

      {membersLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {membersError && !membersLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(membersError, "Не удалось загрузить менеджеров")}
        </div>
      )}

      {!membersLoading && !membersError && list.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-fg-secondary">
              Менеджеров нет — синхронизируйте их на{" "}
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

      {!membersLoading && !membersError && list.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Менеджеры ({list.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {list.map((member) => {
              const value = pending[member.id] ?? currentValue(member);
              return (
                <MemberRow
                  key={member.id}
                  member={member}
                  personOptions={personOptions}
                  value={value}
                  dirty={value !== currentValue(member)}
                  disabled={applying}
                  onChange={(v) =>
                    setPending((p) => ({ ...p, [member.id]: v }))
                  }
                />
              );
            })}

            <ApplyBar
              count={changed.length}
              applying={applying}
              onApply={() => void handleApply()}
            />
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

function MemberRow({
  member,
  personOptions,
  value,
  dirty,
  disabled,
  onChange,
}: {
  member: ChatboxMemberView;
  personOptions: { id: string; name: string }[];
  value: string;
  dirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">
            {member.displayName}
          </span>
          <Badge variant={chatboxLinkModeBadgeVariant(member.linkMode)}>
            {member.linkModeLabel}
          </Badge>
          {dirty && (
            <Badge variant="secondary" className="text-accent">
              изменено
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-fg-tertiary">
          {member.email ?? "—"}
          {member.role ? ` · ${member.role}` : ""}
        </div>
        {member.linkedPersonName && (
          <div className="mt-0.5 truncate text-xs text-fg-secondary">
            Сотрудник: {member.linkedPersonName}
          </div>
        )}
      </div>

      {}
      <div className="flex items-center gap-2 sm:w-72 sm:shrink-0">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Действие" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Не связывать —</SelectItem>
            {personOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
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
