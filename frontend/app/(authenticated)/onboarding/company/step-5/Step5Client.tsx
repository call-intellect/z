'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  IdCard,
  Users,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { structureApi, type StructureSummaryApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Шаг 5 — Готово. Показываем сводку (Departments / Roles / Persons /
 * Documents) и кнопку «Открыть дашборд».
 *
 * `GET /api/v1/structure/summary` может быть ещё не готов — в этом случае
 * рендерим заглушку «Сводка появится после готовности backend» и просто
 * даём кнопку «Открыть дашборд».
 */
export function Step5Client() {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [summary, setSummary] = useState<StructureSummaryApi | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrgId) return;
    let cancelled = false;
    void structureApi
      .summary(currentOrgId)
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setSummaryError(
          e instanceof ApiError ? e.message : 'Не удалось загрузить сводку.',
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  return (
    <section className="text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success">
        <CheckCircle2 size={32} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Знакомство пройдено
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Структура компании зафиксирована. AI начнёт собирать карты должностей
        по мере поступления встреч и документов.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))
        ) : summary ? (
          <>
            <SummaryCard
              icon={<Building2 size={18} />}
              label="Отделов"
              value={summary.departments}
            />
            <SummaryCard
              icon={<IdCard size={18} />}
              label="Должностей"
              value={summary.roles}
            />
            <SummaryCard
              icon={<Users size={18} />}
              label="Сотрудников"
              value={summary.persons}
            />
            <SummaryCard
              icon={<FileText size={18} />}
              label="Документов"
              value={summary.documents}
            />
          </>
        ) : (
          <div className="col-span-full rounded-md border border-dashed border-border-subtle p-4 text-sm text-fg-tertiary">
            {summaryError ?? 'Сводка появится позже.'}
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-center">
        <Button size="lg" onClick={() => router.push('/dashboard')}>
          Открыть дашборд <ArrowRight size={16} className="ml-1" />
        </Button>
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3 text-left">
      <div className="flex items-center justify-between text-fg-tertiary">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-fg-primary">
        {value}
      </div>
    </div>
  );
}
