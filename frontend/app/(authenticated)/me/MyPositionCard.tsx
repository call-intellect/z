"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { BriefcaseBusiness, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  rolesDomainApi,
  personsDomainApi,
  type MyProfileApi,
} from "@/api/structure.api";
import { Button } from "@/ui/shadcn/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/shadcn/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export function MyPositionCard({
  orgId,
  profile,
}: {
  orgId: string;
  profile: MyProfileApi | null;
}) {
  if (profile === null) {
    return (
      <PositionCardShell>
        <p className="text-sm" style={{ color: CHART.faint }}>
          Профиль ещё формируется.
        </p>
      </PositionCardShell>
    );
  }

  if (profile.person === null) {
    return (
      <PositionCardShell>
        <p className="text-sm" style={{ color: CHART.faint }}>
          Профиль ещё формируется. Должность можно будет назначить позже.
        </p>
      </PositionCardShell>
    );
  }

  return (
    <PositionCardShell>
      <PositionEditor
        orgId={orgId}
        personId={profile.person.id}
        currentRole={profile.primaryRole}
      />
    </PositionCardShell>
  );
}

function PositionCardShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="me-card-position" className="mb-6 scroll-mt-24">
      <GlassCard>
        <CardTitle icon={<BriefcaseBusiness size={16} />} grad={GRAD.violet}>
          Должность
        </CardTitle>
        <div className="mt-4">{children}</div>
      </GlassCard>
    </div>
  );
}

function PositionEditor({
  orgId,
  personId,
  currentRole,
}: {
  orgId: string;
  personId: string;
  currentRole: MyProfileApi["primaryRole"];
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const rolesSwr = useSWR(["roles", orgId], () => rolesDomainApi.list(orgId));
  const roles = rolesSwr.data?.items ?? [];

  const trimmed = query.trim();
  const lowered = trimmed.toLowerCase();
  const filtered = lowered
    ? roles.filter((r) => r.name.toLowerCase().includes(lowered))
    : roles;
  const hasExact = roles.some((r) => r.name.trim().toLowerCase() === lowered);

  const closeAll = () => {
    setOpen(false);
    setEditing(false);
    setQuery("");
  };

  const assignRole = async (roleId: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await personsDomainApi.update(orgId, personId, { roleId });
      await mutate(["me-profile", orgId]);
      await mutate(["roles", orgId]);
      toast.success("Должность назначена");
      closeAll();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось назначить должность"));
    } finally {
      setSaving(false);
    }
  };

  const createAndAssign = async (name: string) => {
    if (saving) return;
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    try {
      const res = await rolesDomainApi.create(orgId, { name: clean });
      await personsDomainApi.update(orgId, personId, { roleId: res.role.id });
      await mutate(["me-profile", orgId]);
      await mutate(["roles", orgId]);
      toast.success("Должность назначена");
      closeAll();
    } catch (e) {
      toast.error(humanizeApiError(e, "Не удалось назначить должность"));
    } finally {
      setSaving(false);
    }
  };

  if (currentRole && !editing) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" style={{ color: CHART.dim }}>
          Текущая должность:{" "}
          <span className="font-medium" style={{ color: CHART.text }}>
            {currentRole.name}
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(true);
            setOpen(true);
          }}
        >
          Изменить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!currentRole && (
        <p className="text-sm" style={{ color: CHART.dim }}>
          Назначьте себе должность — выберите из списка или создайте новую.
        </p>
      )}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            if (currentRole) setEditing(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BriefcaseBusiness className="h-4 w-4" />
            )}
            Выбрать или создать должность
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[20rem] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Введите название должности…"
              value={query}
              onValueChange={setQuery}
              disabled={saving}
            />
            <CommandList>
              {filtered.length === 0 && !trimmed && (
                <CommandEmpty>
                  Начните вводить название новой должности
                </CommandEmpty>
              )}
              {filtered.map((role) => (
                <CommandItem
                  key={role.id}
                  value={role.id}
                  disabled={saving}
                  onSelect={() => void assignRole(role.id)}
                >
                  {currentRole?.id === role.id && (
                    <Check className="h-4 w-4 text-accent" />
                  )}
                  <span className="truncate">{role.name}</span>
                </CommandItem>
              ))}
              {trimmed && !hasExact && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  disabled={saving}
                  onSelect={() => void createAndAssign(trimmed)}
                >
                  <Plus className="h-4 w-4 text-accent" />
                  <span className="truncate">
                    Создать должность «{trimmed}»
                  </span>
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
