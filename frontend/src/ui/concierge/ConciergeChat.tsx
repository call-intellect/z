'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  conciergeApi,
  conciergeStreamApi,
  type ConciergePageContextApi,
  type ConciergeStreamEvent,
} from '@/api/concierge.api';
import { tablesApi } from '@/api/tables.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import {
  isInferredTableSchema,
  type InferredTableSchema,
} from '@/domain/table';
import { TableSchemaPreview } from './TableSchemaPreview';
import { toast } from 'sonner';
/**
 * SBA γ-2 — ConciergeChat.
 *
 * Внутренний компонент для floating button, страницы /assistant и
 * <ConciergeSlot>. Делает реальный SSE-streaming через
 * `conciergeStreamApi(...)`; при ошибке/неподдержке — fallback на
 * `conciergeApi.askOnce` (polling).
 *
 * События:
 *   - tool_result с undoLogId → показывает action toast «Готово. Отменить».
 *   - quota_exceeded → показывает error toast с описанием.
 *   - error → красный toast.
 */

export interface ConciergeChatProps {
  /** Контекст страницы (clientPath, currentEntityKind/Id) — необязательно. */
  pageContext?: ConciergePageContextApi;
  /** Если задан — продолжаем conversation. Иначе — новый. */
  conversationId?: string;
  /** Render-prop для контейнера (модалка / страница / слот). */
  className?: string;
  /** Когда новый conversation создан — сообщаем родителю (для URL/state). */
  onConversationStarted?: (id: string) => void;
  /** Префилл поля ввода (например, при открытии «Спросить Кору» из Таблиц). */
  initialInput?: string;
}

interface ChatRow {
  id: string;
  /**
   * `table_schema_preview` — спец-строка с интерактивной карточкой схемы
   * таблицы (Smart-tables Text-to-Schema, Фаза 1).
   */
  kind?: 'table_schema_preview';
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  meta?: { toolName?: string; ok?: boolean; undoLogId?: string };
  /** Заполнено только для `kind === 'table_schema_preview'`. */
  schema?: InferredTableSchema;
}

export function ConciergeChat({
  pageContext,
  conversationId,
  className,
  onConversationStarted,
  initialInput,
}: ConciergeChatProps) {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [rows, setRows] = useState<ChatRow[]>([]);
  const [input, setInput] = useState(initialInput ?? '');
  const [busy, setBusy] = useState(false);
  /** Идёт ли создание таблицы из схемы (блокирует кнопку «Подтвердить»). */
  const [creatingTable, setCreatingTable] = useState(false);
  const [currentConv, setCurrentConv] = useState<string | undefined>(
    conversationId,
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Префилл из родителя (например, кнопка «Спросить Кору» в Таблицах).
  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  const handleCreateFromSchema = useCallback(
    async (schema: InferredTableSchema) => {
      if (!currentOrgId) {
        toast.error('Не выбрана организация');
        return;
      }
      setCreatingTable(true);
      try {
        const created = await tablesApi.createFromSchema(currentOrgId, schema);
        toast.success('Таблица создана', {
          action: {
            label: 'Открыть',
            onClick: () => router.push(`/tables/${created.id}`),
          },
        });
        router.push(`/tables/${created.id}`);
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.code === 'feature_tables_text_to_schema_disabled'
        ) {
          toast.error(
            'Создание таблиц по описанию пока отключено в этой организации',
          );
        } else {
          toast.error(
            e instanceof ApiError ? e.message : 'Не удалось создать таблицу',
          );
        }
      } finally {
        setCreatingTable(false);
      }
    },
    [currentOrgId, router],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  const handleUndo = useCallback(
    async (logId: string) => {
      try {
        const res = await conciergeApi.undo(logId);
        if (res.ok) {
          toast.success('Действие отменено');
        } else {
          toast.error(res.message ?? 'Не удалось отменить');
        }
      } catch {
        toast.error('Ошибка отмены');
      }
    },
    [],
  );

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput('');
    setBusy(true);
    setRows((r) => [
      ...r,
      { id: `u-${Date.now()}`, role: 'user', text: trimmed },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let sseFailed = false;
    try {
      for await (const ev of conciergeStreamApi(
        {
          userMessage: trimmed,
          ...(currentConv ? { conversationId: currentConv } : {}),
          ...(pageContext ? { pageContext } : {}),
        },
        controller.signal,
      )) {
        applyEvent(ev);
      }
    } catch (err) {
      // Fallback на polling.
      sseFailed = true;
      console.warn('Concierge SSE failed, fallback to polling:', err);
    } finally {
      abortRef.current = null;
    }

    if (sseFailed) {
      try {
        const r = await conciergeApi.askOnce({
          userMessage: trimmed,
          ...(currentConv ? { conversationId: currentConv } : {}),
          ...(pageContext ? { pageContext } : {}),
        });
        if (r.quotaExceeded) {
          toast.error(r.quotaExceeded === 'daily'
                ? 'Дневная квота Concierge исчерпана'
                : 'Месячная квота Concierge исчерпана');
        } else if (r.error) {
          toast.error(r.error.message);
        } else {
          if (!currentConv && r.conversationId) {
            setCurrentConv(r.conversationId);
            onConversationStarted?.(r.conversationId);
          }
          for (const tc of r.toolCalls) {
            setRows((prev) => [
              ...prev,
              {
                id: `t-${tc.toolName}-${Date.now()}`,
                role: 'tool',
                text: `Инструмент: ${tc.toolName} (${tc.ok ? 'ок' : 'ошибка'})`,
                meta: {
                  toolName: tc.toolName,
                  ok: tc.ok,
                  ...(tc.undoLogId ? { undoLogId: tc.undoLogId } : {}),
                },
              },
            ]);
            if (tc.undoLogId) {
              toast.success(`Готово: ${tc.toolName}`, { action: { label: 'Отменить', onClick: () => handleUndo(tc.undoLogId!) } });
            }
          }
          if (r.text) {
            setRows((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: r.text,
              },
            ]);
          }
        }
      } catch {
        toast.error('Concierge временно недоступен');
      }
    }

    setBusy(false);

    function applyEvent(ev: ConciergeStreamEvent) {
      switch (ev.type) {
        case 'started':
          if (!currentConv) {
            setCurrentConv(ev.conversationId);
            onConversationStarted?.(ev.conversationId);
          }
          break;
        case 'tool_call':
          setRows((prev) => [
            ...prev,
            {
              id: `tc-${Date.now()}`,
              role: 'system',
              text: `Вызываю инструмент: ${ev.toolName}${
                ev.requiresConfirm ? ' (требуется подтверждение)' : ''
              }`,
            },
          ]);
          break;
        case 'tool_result':
          // Smart-tables Text-to-Schema (Фаза 1) — для инструмента
          // `infer_table_schema` backend кладёт полную схему в `ev.data`.
          // Рисуем интерактивную карточку-превью вместо текстовой строки.
          if (
            ev.toolName === 'infer_table_schema' &&
            ev.ok &&
            isInferredTableSchema(ev.data)
          ) {
            const schema = ev.data;
            setRows((prev) => [
              ...prev,
              {
                id: `ts-${Date.now()}`,
                kind: 'table_schema_preview',
                role: 'tool',
                text: 'Предлагаю такую таблицу',
                schema,
              },
            ]);
            break;
          }
          setRows((prev) => [
            ...prev,
            {
              id: `tr-${Date.now()}`,
              role: 'tool',
              text: `${ev.toolName}: ${ev.ok ? 'успех' : `ошибка ${ev.status}`}`,
              meta: {
                toolName: ev.toolName,
                ok: ev.ok,
                ...(ev.undoLogId ? { undoLogId: ev.undoLogId } : {}),
              },
            },
          ]);
          if (ev.undoLogId) {
            toast.success(`Готово: ${ev.toolName}`, { action: { label: 'Отменить', onClick: () => handleUndo(ev.undoLogId!) } });
          }
          break;
        case 'message':
          setRows((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: 'assistant', text: ev.text },
          ]);
          break;
        case 'quota_exceeded':
          toast.error(ev.scope === 'daily'
                ? 'Дневная квота Concierge исчерпана'
                : 'Месячная квота Concierge исчерпана');
          break;
        case 'error':
          toast.error(ev.message);
          break;
        case 'thinking':
        case 'done':
        default:
          break;
      }
    }
  }, [input, busy, currentConv, pageContext, handleUndo, onConversationStarted]);

  return (
    <div
      className={
        className ??
        'flex h-full max-h-[600px] w-full flex-col rounded-md border border-border-subtle bg-bg-base'
      }
    >
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-3 text-sm"
      >
        {rows.length === 0 && (
          <div className="text-center text-fg-tertiary">
            Я Concierge. Спросите что-нибудь или попросите выполнить действие.
          </div>
        )}
        {rows.map((row) =>
          row.kind === 'table_schema_preview' && row.schema ? (
            <TableSchemaPreview
              key={row.id}
              schema={row.schema}
              onConfirm={handleCreateFromSchema}
              busy={creatingTable}
            />
          ) : (
            <div
              key={row.id}
              className={
                row.role === 'user'
                  ? 'rounded-md bg-bg-overlay p-2'
                  : row.role === 'assistant'
                    ? 'rounded-md bg-chip-success-bg p-2 text-chip-success-fg'
                    : 'rounded-md bg-bg-subtle p-2 text-xs text-fg-tertiary'
              }
            >
              {row.text}
            </div>
          ),
        )}
        {busy && (
          <div className="text-xs text-fg-tertiary">Concierge печатает…</div>
        )}
      </div>
      <form
        className="flex gap-2 border-t border-border-subtle p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          className="flex-1 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm"
          placeholder="Что нужно сделать?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-50"
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
