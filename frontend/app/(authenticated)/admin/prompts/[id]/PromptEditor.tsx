'use client';

/**
 * Фаза A.2 — `PromptEditor` — редактор разделов одного шаблона.
 *
 * Drag-n-drop пока через кнопки «Вверх / Вниз» (@dnd-kit в проекте нет).
 * Лимит 30 секций, лимит instruction 4000 символов, сумма maxTokens ≤ 16000.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';

import {
  adminPromptTemplatesApi,
  OUTPUT_TYPES,
  type OutputTypeApi,
  type PromptSectionApi,
  type PromptVersionWithSectionsApi,
} from '@/api/admin-prompt-templates.api';
import { outputTypeLabel } from '@/domain/admin-prompt-template';
import { ApiError } from '@/api/api-error';
import { toast } from 'sonner';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

const SECTIONS_MAX = 30;
const MAX_TOKENS_SUM = 16000;

type SectionDraft = Omit<PromptSectionApi, 'id' | 'versionId'>;

function emptySection(order: number): SectionDraft {
  return {
    order,
    key: '',
    title: '',
    instruction: '',
    outputType: 'text' as OutputTypeApi,
    required: true,
    maxTokens: null,
  };
}

export function PromptEditor({
  templateId,
  activeVersion,
  onSaved,
  onOpenPreview,
}: {
  templateId: string;
  activeVersion: PromptVersionWithSectionsApi | null;
  onSaved: () => void;
  onOpenPreview: () => void;
}) {

  const [systemPrompt, setSystemPrompt] = useState('');
  const [toolName, setToolName] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeVersion) {
      setSystemPrompt(activeVersion.systemPrompt);
      setToolName(activeVersion.toolName ?? '');
      setSections(
        activeVersion.sections.map((s) => ({
          order: s.order,
          key: s.key,
          title: s.title,
          instruction: s.instruction,
          outputType: s.outputType,
          required: s.required,
          maxTokens: s.maxTokens,
        })),
      );
    }
  }, [activeVersion]);

  const sumMaxTokens = useMemo(
    () => sections.reduce((acc, s) => acc + (s.maxTokens ?? 0), 0),
    [sections],
  );

  const overTokens = sumMaxTokens > MAX_TOKENS_SUM;

  const addSection = () => {
    if (sections.length >= SECTIONS_MAX) {
      toast.error(`Лимит ${SECTIONS_MAX} разделов`);
      return;
    }
    setSections((prev) => [...prev, emptySection(prev.length + 1)]);
  };

  const removeSection = (idx: number) => {
    setSections((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, order: i + 1 })),
    );
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = prev.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[idx]!;
      const b = next[target]!;
      next[idx] = b;
      next[target] = a;
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const updateSection = (idx: number, patch: Partial<SectionDraft>) => {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const saveAs = async (activate: boolean) => {
    if (systemPrompt.trim().length < 10) {
      toast.error('Системный промпт — минимум 10 символов');
      return;
    }
    for (const s of sections) {
      if (!s.key || !s.title || s.instruction.length < 10) {
        toast.error('У каждого раздела должны быть ключ, название и инструкция от 10 символов');
        return;
      }
    }
    if (overTokens) {
      toast.error(`Сумма лимита токенов превышает ${MAX_TOKENS_SUM}`);
      return;
    }
    setSaving(true);
    try {
      await adminPromptTemplatesApi.createVersion(templateId, {
        systemPrompt: systemPrompt.trim(),
        toolName: toolName.trim() ? toolName.trim() : null,
        sections: sections.map((s, i) => ({
          ...s,
          order: i + 1,
        })),
        notes: notes.trim() || null,
        activate,
      });
      toast.success(activate ? 'Версия сохранена и активирована' : 'Версия сохранена');
      setNotes('');
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось сохранить';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Системный промпт</h2>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          maxLength={40000}
          placeholder="Опиши общую роль ИИ-аналитика и контекст. Этот текст ставится в начало system-message."
          className="w-full rounded-md border border-slate-200 bg-white p-2 font-mono text-xs"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <label className="flex items-center gap-2">
            <span>Имя tool-функции (необязательно)</span>
            <input
              type="text"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="extract_sales"
              className="h-7 w-48 rounded border border-slate-200 bg-white px-2 font-mono text-xs"
            />
          </label>
          <span>{systemPrompt.length} символов</span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Разделы отчёта ({sections.length} / {SECTIONS_MAX})
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className={overTokens ? 'text-red-600' : 'text-slate-500'}>
              Сумма лимита токенов: {sumMaxTokens} / {MAX_TOKENS_SUM}
            </span>
            <Button variant="secondary" size="sm" onClick={addSection}>
              <Plus size={14} className="mr-1" /> Добавить раздел
            </Button>
          </div>
        </header>

        {sections.length === 0 && (
          <div className="rounded border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            Пока нет разделов. Добавьте хотя бы один — он будет одним из полей итогового отчёта.
          </div>
        )}

        <div className="space-y-3">
          {sections.map((s, idx) => (
            <div key={idx} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-mono text-slate-700">
                  №{idx + 1}
                </span>
                <input
                  type="text"
                  value={s.title}
                  onChange={(e) => updateSection(idx, { title: e.target.value })}
                  placeholder="Название раздела"
                  className="h-8 flex-1 rounded border border-slate-200 bg-white px-2 text-sm"
                  maxLength={160}
                />
                <input
                  type="text"
                  value={s.key}
                  onChange={(e) => updateSection(idx, { key: e.target.value })}
                  placeholder="ключ_для_JSON"
                  className="h-8 w-40 rounded border border-slate-200 bg-white px-2 font-mono text-xs"
                  maxLength={80}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveSection(idx, -1)}
                  disabled={idx === 0}
                  className="h-7 w-7 p-0"
                  aria-label="Вверх"
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveSection(idx, 1)}
                  disabled={idx === sections.length - 1}
                  className="h-7 w-7 p-0"
                  aria-label="Вниз"
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(idx)}
                  className="h-7 w-7 p-0 text-red-600"
                  aria-label="Удалить"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <textarea
                value={s.instruction}
                onChange={(e) => updateSection(idx, { instruction: e.target.value })}
                rows={3}
                maxLength={4000}
                placeholder="Инструкция для ИИ: что именно писать в этом разделе."
                className="w-full rounded border border-slate-200 bg-white p-2 text-xs"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  <span>Тип вывода:</span>
                  <Select
                    value={s.outputType}
                    onValueChange={(v) => updateSection(idx, { outputType: v as OutputTypeApi })}
                  >
                    <SelectTrigger className="h-7 w-40 bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTPUT_TYPES.map((o) => (
                        <SelectItem key={o} value={o}>
                          {outputTypeLabel(o)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={s.required}
                    onChange={(e) => updateSection(idx, { required: e.target.checked })}
                  />
                  <span>Обязательный</span>
                </label>
                <label className="flex items-center gap-1">
                  <span>Лимит токенов:</span>
                  <input
                    type="number"
                    min={0}
                    max={8000}
                    value={s.maxTokens ?? ''}
                    onChange={(e) =>
                      updateSection(idx, {
                        maxTokens: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="h-7 w-20 rounded border border-slate-200 bg-white px-2 text-xs"
                  />
                </label>
                <span className="text-slate-500">{s.instruction.length} / 4000</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Заметка к версии</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Что изменилось в этой версии. Будет видно в истории."
          className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm"
        />
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <Button variant="ghost" size="sm" onClick={onOpenPreview} disabled={saving}>
          Предпросмотр на демо-встрече
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => saveAs(false)} disabled={saving}>
            {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
            Сохранить как новую версию
          </Button>
          <Button size="sm" onClick={() => saveAs(true)} disabled={saving}>
            {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
            Сохранить и активировать
          </Button>
        </div>
      </div>
    </div>
  );
}
