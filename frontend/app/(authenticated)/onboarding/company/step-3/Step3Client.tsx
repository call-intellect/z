"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  personsDomainApi,
  rolesDomainApi,
  type RoleDomainApi,
} from "@/api/structure.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Skeleton } from "@/ui/shadcn/skeleton";

import { WizardStepNav } from "../WizardStepNav";

interface PersonDraft {
  name: string;
  email: string;
  roleId: string | null;
}

const PREV_HREF = "/onboarding/company/step-2";
const NEXT_HREF = "/onboarding/company/step-4";
const NO_ROLE_VALUE = "__none__";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Step3Client() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [roles, setRoles] = useState<RoleDomainApi[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rows, setRows] = useState<PersonDraft[]>([
    { name: "", email: "", roleId: null },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentOrgId) return;
    let cancelled = false;
    void rolesDomainApi
      .list(currentOrgId)
      .then((res) => {
        if (cancelled) return;
        setRoles(res.items);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg =
          e instanceof ApiError ? e.message : "Не удалось загрузить должности.";
        setRolesError(msg);
        setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  const addRow = () =>
    setRows((rs) => [...rs, { name: "", email: "", roleId: null }]);
  const removeRow = (idx: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== idx)));
  const updateRow = (idx: number, patch: Partial<PersonDraft>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const valid = rows
    .map((r) => ({
      ...r,
      name: r.name.trim(),
      email: r.email.trim(),
    }))
    .filter((r) => r.name.length > 0 && EMAIL_RE.test(r.email));

  const canSubmit = valid.length > 0 && Boolean(currentOrgId);

  const handleSubmit = async () => {
    if (!canSubmit || !currentOrgId) return;
    setSubmitting(true);
    try {
      await Promise.all(
        valid.map((r) =>
          personsDomainApi.create(currentOrgId, {
            fullName: r.name,
            email: r.email,
            roleId: r.roleId,
          }),
        ),
      );
      toast.success("Сотрудники сохранены.");
      router.push(NEXT_HREF);
    } catch (e) {
      const msg = humanizeApiError(e, "Не удалось сохранить сотрудников.");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (roles === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Сначала добавьте должности
        </h1>
        <p className="text-sm text-fg-secondary">
          Сотрудник привязывается к должности. Вернитесь на шаг 2 и создайте
          хотя бы одну должность.
        </p>
        {rolesError && <p className="text-sm text-danger">{rolesError}</p>}
        <Button onClick={() => router.push(PREV_HREF)}>← К шагу 2</Button>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Кто работает в компании?
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Внесите ключевых сотрудников. По email каждому можно будет отправить
        приглашение позже из раздела «Структура».
      </p>

      <div className="mt-6 space-y-3">
        <Label>Сотрудники</Label>
        {rows.map((row, idx) => {
          const emailOk = !row.email.trim() || EMAIL_RE.test(row.email.trim());
          return (
            <div
              key={idx}
              className="grid grid-cols-1 gap-2 md:grid-cols-[1fr,1fr,1fr,auto]"
            >
              <Input
                value={row.name}
                onChange={(e) => updateRow(idx, { name: e.target.value })}
                placeholder="Имя"
                autoFocus={idx === 0}
              />
              <div>
                <Input
                  type="email"
                  value={row.email}
                  onChange={(e) => updateRow(idx, { email: e.target.value })}
                  placeholder="email@example.ru"
                  aria-invalid={!emailOk}
                />
                {!emailOk && (
                  <p className="mt-1 text-xs text-danger">
                    Некорректный email.
                  </p>
                )}
              </div>
              <Select
                value={row.roleId ?? NO_ROLE_VALUE}
                onValueChange={(v) =>
                  updateRow(idx, { roleId: v === NO_ROLE_VALUE ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Должность" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE_VALUE}>Без должности</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeRow(idx)}
                disabled={rows.length <= 1}
                aria-label="Удалить строку"
              >
                <X size={16} />
              </Button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          onClick={addRow}
          className="text-fg-secondary"
        >
          <Plus size={14} className="mr-1" /> Добавить ещё
        </Button>
      </div>

      <WizardStepNav
        prevHref={PREV_HREF}
        nextDisabled={!canSubmit}
        submitting={submitting}
        onNext={handleSubmit}
        nextLabel="Сохранить и далее"
      />
    </section>
  );
}
