'use client';

import Link from 'next/link';
import { CheckCircle2, Sparkles, MessageSquare } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { useAuth } from '@/contexts/auth-context';

/**
 * `/me/dashboard` — личный «что важно сегодня».
 * Phase 2 — каркас секций (важное / спотлайты / упоминания / чек-ин).
 * Реальные источники данных подключаются в Sprint 3-5.
 */
export function MyDashboardClient() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
          Добрый день{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-sm text-fg-tertiary">
          Что важно сегодня и куда обратить внимание
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg-primary">Чек-ин сегодня</h2>
          <Button asChild size="sm" variant="default" className="gap-2">
            <Link href="/me/check-ins">
              <CheckCircle2 size={14} />
              Открыть чек-ин
            </Link>
          </Button>
        </div>
        <p className="text-xs text-fg-tertiary">
          Расскажите, что сделали, что планируете, что мешает.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-fg-primary">
          <Sparkles size={14} className="text-accent" />
          Спотлайты вам
        </h2>
        <p className="text-xs text-fg-tertiary">
          Публичные «спасибо» от коллег появятся в Sprint 4.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-fg-primary">
          <MessageSquare size={14} />
          Мои упоминания
        </h2>
        <p className="text-xs text-fg-tertiary">
          @-упоминания из задач и комментариев появятся в Sprint 3.
        </p>
      </section>
    </div>
  );
}
