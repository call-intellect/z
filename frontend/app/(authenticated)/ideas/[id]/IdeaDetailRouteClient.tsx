'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import useSWR from 'swr';

import { ideasApi } from '@/api/ideas.api';
import { mapIdeaDetail } from '@/domain/idea';
import { useRegisterBreadcrumb } from '@/ui/components/breadcrumbs/BreadcrumbContext';
import { Button } from '@/ui/shadcn/button';

import { IdeaDetailPane } from '../IdeasListClient';

/**
 * #80 — отдельный роут детали идеи `/ideas/[id]`. Виджеты дашборда и /me строят
 * deep-link сюда (раньше роута не было → 404 при prefetch/переходе). Грузит идею
 * по id (tenant-scoped эндпоинт `GET /ideas/:id`), переиспользует IdeaDetailPane.
 */
export function IdeaDetailRouteClient({ ideaId }: { ideaId: string }) {
  const swr = useSWR(['idea-detail', ideaId], async () => {
    const api = await ideasApi.getById(ideaId);
    return mapIdeaDetail(api);
  });

  // Хлебные крошки: текст идеи из уже загруженного объекта (поле `statement` —
  // у IdeaDetail нет `title`).
  useRegisterBreadcrumb(swr.data ? { label: swr.data.statement } : null);

  if (swr.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Идея не найдена или у вас нет доступа.
        </div>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/ideas">
            <ChevronLeft size={16} /> Все идеи
          </Link>
        </Button>
      </div>
    );
  }

  const idea = swr.data;
  if (!idea) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Button asChild variant="ghost" className="mb-4">
        <Link href="/ideas">
          <ChevronLeft size={16} /> Все идеи
        </Link>
      </Button>
      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <IdeaDetailPane
          idea={idea}
          onUpdated={(d) => void swr.mutate(d, false)}
          onListChanged={() => void swr.mutate()}
        />
      </div>
    </div>
  );
}
