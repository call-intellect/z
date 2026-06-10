'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Brain, CheckCircle2, Loader2, Send } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { dumpApi } from '@/api/dump.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { generateNonce } from '@/domain/source';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

const MAX_LEN = 50_000;

/**
 * Клиент страницы `/dump` — веб-форма «дамп мысли» (Шаг 10 Фазы 10).
 *
 * UX:
 *   - Большая monospace textarea с placeholder.
 *   - Счётчик символов (0 / 50 000), краснеет при > 90% лимита.
 *   - Submit генерирует `nonce` (uuid-v4) → `POST /api/v1/ingest/dump`.
 *   - На 429 `quota_exceeded` — toast «Лимит 30 мыслей в день…».
 *   - На успех — toast и очистка textarea.
 */
export function DumpClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const trimmed = text.trim();
  const len = text.length;
  const overflow = len > MAX_LEN;
  const nearLimit = len > MAX_LEN * 0.9;
  const canSubmit = !submitting && trimmed.length > 0 && !overflow && Boolean(currentOrgId);

  const handleSubmit = async () => {
    if (!canSubmit || !currentOrgId) return;
    setSubmitting(true);
    try {
      const nonce = generateNonce();
      const res = await dumpApi.create(currentOrgId, {
        text,
        nonce,
      });
      if (res.idempotent) {
        toast('Эта мысль уже была сохранена ранее');
      } else {
        toast.success('Мысль сохранена в память компании');
      }
      setText('');
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'quota_exceeded') {
        toast.error('Лимит 30 мыслей в день. Попробуйте позже.');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
        <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Эта страница доступна только в рамках организации. Создайте или присоединитесь к организации.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <header className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-overlay text-accent">
          <Brain size={18} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Дамп мысли
          </h1>
          <p className="text-sm text-fg-secondary">
            Любая мысль, замечание или идея. Через несколько минут она попадёт
            в общую память компании и появится в поиске и помощнике.
          </p>
        </div>
      </header>

      {saved && (
        <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2
              size={18}
              className="mt-0.5 shrink-0 text-success"
            />
            <div className="space-y-2">
              <p className="font-medium text-success">
                Мысль сохранена в память компании
              </p>
              <p className="text-fg-secondary">
                Через несколько минут она появится в поиске и у помощника
                компании — у него можно сразу спросить по ней.
              </p>
              <div className="flex flex-wrap gap-3 pt-0.5">
                <Link href="/chat" className="text-accent hover:underline">
                  Спросить помощника компании
                </Link>
                <Link href="/ideas" className="text-accent hover:underline">
                  Открыть «Идеи»
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (saved) setSaved(false);
          }}
          placeholder="Что вы думаете? Любая мысль, замечание, идея..."
          className="min-h-[60vh] resize-none font-mono text-sm leading-relaxed"
          disabled={submitting}
          maxLength={MAX_LEN + 1}
          autoFocus
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-tertiary">
            Если отправить ту же мысль ещё раз — дубль не создастся.
          </span>
          <span
            className={
              overflow
                ? 'text-danger'
                : nearLimit
                  ? 'text-warning'
                  : 'text-fg-tertiary'
            }
          >
            {len.toLocaleString('ru')} / {MAX_LEN.toLocaleString('ru')}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {submitting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          Сохранить мысль
        </Button>
      </div>
    </div>
  );
}
