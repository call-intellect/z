'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  departmentsApi,
  rolesDomainApi,
  type DepartmentApi,
} from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { WizardStepNav } from '../WizardStepNav';

interface RoleDraft {
  name: string;
  departmentId: string | null;
}

const PREV_HREF = '/onboarding/company/step-1';
const NEXT_HREF = '/onboarding/company/step-3';
/** «Без отдела» в select — Radix не любит value=''. */
const NO_DEPARTMENT_VALUE = '__none__';

/**
 * Шаг 2 — Должности. Каждая строка: название + select отдела (из step-1).
 * Если в step-1 ничего не создалось (API не готов или owner проскипал) —
 * показываем баннер «Сначала создайте отделы» и кнопку «Назад».
 */
export function Step2Client() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [departments, setDepartments] = useState<DepartmentApi[] | null>(null);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [rows, setRows] = useState<RoleDraft[]>([
    { name: '', departmentId: null },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentOrgId) return;
    let cancelled = false;
    void departmentsApi
      .list(currentOrgId)
      .then((res) => {
        if (cancelled) return;
        setDepartments(res.items);
        // Если есть только один отдел — подставим его по умолчанию.
        if (res.items.length === 1) {
          setRows((rs) =>
            rs.map((r) => ({
              ...r,
              departmentId: r.departmentId ?? res.items[0]!.id,
            })),
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const msg =
          e instanceof ApiError ? e.message : 'Не удалось загрузить отделы.';
        setDepartmentsError(msg);
        setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        name: '',
        departmentId:
          departments && departments.length === 1
            ? departments[0]!.id
            : null,
      },
    ]);
  const removeRow = (idx: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== idx)));
  const updateName = (idx: number, name: string) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, name } : r)));
  const updateDept = (idx: number, departmentId: string | null) =>
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, departmentId } : r)),
    );

  const cleaned = rows
    .map((r) => ({ ...r, name: r.name.trim() }))
    .filter((r) => r.name.length > 0);
  const canSubmit = cleaned.length > 0 && Boolean(currentOrgId);

  const handleSubmit = async () => {
    if (!canSubmit || !currentOrgId) return;
    setSubmitting(true);
    try {
      await Promise.all(
        cleaned.map((r) =>
          rolesDomainApi.create(currentOrgId, {
            name: r.name,
            departmentId: r.departmentId,
          }),
        ),
      );
      toast.success('Должности сохранены.');
      router.push(NEXT_HREF);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось сохранить должности.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (departments === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (departments.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Сначала добавьте отделы
        </h1>
        <p className="text-sm text-fg-secondary">
          Должности привязываются к отделам. Вернитесь на шаг 1 и создайте
          хотя бы один отдел.
        </p>
        {departmentsError && (
          <p className="text-sm text-danger">{departmentsError}</p>
        )}
        <Button onClick={() => router.push(PREV_HREF)}>← К шагу 1</Button>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Какие должности есть в компании?
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Перечислите должности и привяжите каждую к отделу. Точные роли в
        компании — позже можно будет переименовать или добавить.
      </p>

      <div className="mt-6 space-y-2">
        <Label>Должности</Label>
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr,1fr,auto]">
            <Input
              value={row.name}
              onChange={(e) => updateName(idx, e.target.value)}
              placeholder="Например, Менеджер по продажам"
              autoFocus={idx === 0}
            />
            <Select
              value={row.departmentId ?? NO_DEPARTMENT_VALUE}
              onValueChange={(v) =>
                updateDept(idx, v === NO_DEPARTMENT_VALUE ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Отдел" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT_VALUE}>Без отдела</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
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
        ))}
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
