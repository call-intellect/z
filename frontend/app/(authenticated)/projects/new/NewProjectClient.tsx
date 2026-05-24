'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';
import { Label } from '@/ui/shadcn/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { useAuth } from '@/contexts/auth-context';
import { projectsApi } from '@/api/tracker/projects.api';
import { FromTemplateWizard } from './FromTemplateWizard';

/**
 * `/projects/new` — создание проекта в двух режимах:
 *   - «Пустой проект» — старая форма (минимальный набор полей);
 *   - «Из шаблона» — 3-step wizard на базе TeamTemplate (Phase 4 / Sprint 9,
 *     `POST /api/v1/projects/from-template`).
 */
export function NewProjectClient() {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [tab, setTab] = useState<'template' | 'blank'>('template');

  // Поля «пустого проекта».
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrgId) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await projectsApi.create(currentOrgId, {
        slug: slug.trim().toLowerCase(),
        identifier: identifier.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
      });
      router.push(`/projects/${encodeURIComponent(project.slug)}/board`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать проект');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
          Новый проект
        </h1>
        <p className="text-sm text-fg-tertiary">
          Выберите готовый шаблон команды или создайте пустой проект.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'template' | 'blank')}>
        <TabsList>
          <TabsTrigger value="template">
            <Sparkles size={14} />
            Из шаблона
          </TabsTrigger>
          <TabsTrigger value="blank">
            <FilePlus2 size={14} />
            Пустой проект
          </TabsTrigger>
        </TabsList>

        <TabsContent value="template">
          <FromTemplateWizard />
        </TabsContent>

        <TabsContent value="blank">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="name">Название</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Маркетинг Q2"
                required
                maxLength={200}
                disabled={submitting}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="marketing-q2"
                  required
                  minLength={2}
                  maxLength={60}
                  pattern="^[a-z0-9-]+$"
                  disabled={submitting}
                />
                <span className="text-[11px] text-fg-tertiary">
                  Латиница, цифры, дефис. URL-сегмент.
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="identifier">Идентификатор задач</Label>
                <Input
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
                  placeholder="MKT"
                  required
                  minLength={2}
                  maxLength={5}
                  disabled={submitting}
                />
                <span className="text-[11px] text-fg-tertiary">
                  2-5 латинских букв, например MKT → MKT-1, MKT-2.
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="description">Описание (необязательно)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                disabled={submitting}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Создать проект
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
