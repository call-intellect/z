'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  Bold,
  ChevronRight,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Link2,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  COMPUTED_TYPES,
  FAZA1_SUPPORTED_TYPES,
  PROP_TYPE_LABEL_RU,
  formatCellValue,
  isReadonlyProperty,
  type TablePropertyDomain,
  type TableRowDomain,
} from '@/domain/table';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Sheet, SheetContent } from '@/ui/shadcn/sheet';
import { Textarea } from '@/ui/shadcn/textarea';

/**
 * Карточка строки (Фаза 2 ТЗ smart-tables) — открывается как side-panel справа.
 *
 * Содержит:
 *   1. Шапку: имя строки (берётся из `isPrimary` property или fallback) +
 *      статус сохранения + кнопка «Закрыть».
 *   2. Список property'ей: каждая в одну строку «название — значение».
 *      Inline-edit для текстов/чисел/email/url/phone/checkbox. Status / select
 *      / person / date — read-only display (полноценный редактор будет в
 *      следующих фазах, чтобы переиспользовать popover'ы из Grid).
 *   3. Разделитель + Tiptap editor для `pageContent` (rich text).
 *   4. Заглушки разделов «Комментарии» и «История изменений» (Фаза 2+).
 *
 * Persistence:
 *   - Изменение property → `onUpdateCell` (store сам debounce'ит PATCH 500ms).
 *   - Изменение Tiptap content → `onUpdatePageContent` (store сам debounce'ит).
 *
 * Cover / emoji строки — отсутствуют в Prisma-схеме TableRow (есть только у
 * Table), поэтому в UI не рисуются.
 */

const ALLOWED_INLINE_TYPES = new Set([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'url',
  'email',
  'phone',
  'checkbox',
]);

/**
 * Подсказка для read-only attribute-полей (Smart-tables Фаза 2): значение
 * приходит из памяти компании (граф знаний / Entity) и редактируется в самой
 * сущности, а не в таблице.
 */
const READONLY_HINT =
  'Значение приходит из памяти компании и редактируется в самой сущности';

export interface RowDetailProps {
  open: boolean;
  onClose: () => void;
  tableId: string;
  /** Имя таблицы для breadcrumb. Если не передано — fallback «Таблица». */
  tableName?: string;
  rowId: string | null;
  properties: TablePropertyDomain[];
  rowData: TableRowDomain | null;
  onUpdateCell: (rowId: string, propertyId: string, value: unknown) => void;
  onUpdatePageContent: (
    rowId: string,
    pageContentJson: Record<string, unknown> | null,
  ) => void;
}

export function RowDetail({
  open,
  onClose,
  tableName,
  rowId,
  properties,
  rowData,
  onUpdateCell,
  onUpdatePageContent,
}: RowDetailProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-[640px] md:max-w-[640px]"
        // Закрытие по клику вне — стандартное поведение Sheet.
        // Esc и кнопка X обрабатываются Radix.
      >
        {rowId && rowData ? (
          <RowDetailContent
            rowId={rowId}
            tableName={tableName}
            properties={properties}
            rowData={rowData}
            onUpdateCell={onUpdateCell}
            onUpdatePageContent={onUpdatePageContent}
            onClose={onClose}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-fg-secondary">
            Строка не выбрана
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface RowDetailContentProps {
  rowId: string;
  tableName?: string;
  properties: TablePropertyDomain[];
  rowData: TableRowDomain;
  onUpdateCell: (rowId: string, propertyId: string, value: unknown) => void;
  onUpdatePageContent: (
    rowId: string,
    pageContentJson: Record<string, unknown> | null,
  ) => void;
  onClose: () => void;
}

/**
 * Tone-маппинг для шапки строки (фон + текст) по значению status-property.
 * Совпадает с эвристикой GridView (русские/английские синонимы).
 */
type HeaderTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const HEADER_TONE_BG: Record<HeaderTone, string> = {
  success: 'bg-chip-success-bg/10',
  warning: 'bg-chip-warning-bg/10',
  danger: 'bg-chip-danger-bg/10',
  info: 'bg-chip-info-bg/10',
  neutral: 'bg-bg-subtle',
};

const HEADER_TONE_DOT: Record<HeaderTone, string> = {
  success: 'bg-chip-success-fg',
  warning: 'bg-chip-warning-fg',
  danger: 'bg-chip-danger-fg',
  info: 'bg-chip-info-fg',
  neutral: 'bg-fg-tertiary',
};

function pickHeaderTone(label: string | null): HeaderTone {
  if (!label) return 'neutral';
  const l = label.trim().toLowerCase();
  if (!l) return 'neutral';
  if (/^(готово|сделано|завершено|done|complete|closed|success|ок|ok)$/.test(l))
    return 'success';
  if (
    /^(в работе|in.progress|active|идёт|идет|review|на проверке|открыт)$/.test(
      l,
    )
  )
    return 'info';
  if (
    /^(планируется|backlog|todo|новая|новое|новый|план|to.?do|ожидание|waiting)$/.test(
      l,
    )
  )
    return 'warning';
  if (
    /^(блокировано|отменено|cancelled|canceled|blocked|fail|failed|error|просрочено|overdue)$/.test(
      l,
    )
  )
    return 'danger';
  return 'neutral';
}

function RowDetailContent({
  rowId,
  tableName,
  properties,
  rowData,
  onUpdateCell,
  onUpdatePageContent,
  onClose,
}: RowDetailContentProps) {
  // Заголовок берём из isPrimary property — если её нет, из первой текстовой,
  // иначе — «Без названия».
  const title = useMemo(() => {
    const primary = properties.find((p) => p.isPrimary);
    if (primary) {
      const display = formatCellValue(rowData.cells[primary.id], primary.type);
      if (display) return display;
    }
    const firstText = properties.find(
      (p) => p.type === 'text' || p.type === 'longtext',
    );
    if (firstText) {
      const display = formatCellValue(rowData.cells[firstText.id], firstText.type);
      if (display) return display;
    }
    return 'Без названия';
  }, [properties, rowData.cells]);

  // Сортируем по order — порядок как в Grid.
  const sortedProps = useMemo(
    () => [...properties].sort((a, b) => a.order - b.order),
    [properties],
  );

  // Tone шапки — по значению первой `status`-колонки строки, если есть.
  const headerTone = useMemo<HeaderTone>(() => {
    const statusProp = properties.find((p) => p.type === 'status');
    if (!statusProp) return 'neutral';
    const label = formatCellValue(rowData.cells[statusProp.id], 'status');
    return pickHeaderTone(label || null);
  }, [properties, rowData.cells]);

  const statusLabel = useMemo(() => {
    const statusProp = properties.find((p) => p.type === 'status');
    if (!statusProp) return null;
    const label = formatCellValue(rowData.cells[statusProp.id], 'status');
    return label || null;
  }, [properties, rowData.cells]);

  return (
    <div className="flex h-full flex-col">
      {/* Шапка — тоновый фон по статусу строки */}
      <div
        className={`border-b border-border-subtle px-6 pb-5 pt-4 transition-colors ${HEADER_TONE_BG[headerTone]}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <nav
              aria-label="Хлебные крошки"
              className="mb-2 flex items-center gap-1 text-xs text-fg-tertiary"
            >
              <span className="truncate">{tableName ?? 'Таблица'}</span>
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
              <span className="text-fg-secondary">Строка</span>
            </nav>
            <h2 className="truncate text-lg font-semibold text-fg-primary">
              {title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
              {statusLabel ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${HEADER_TONE_DOT[headerTone]}`}
                    aria-hidden
                  />
                  {statusLabel}
                </span>
              ) : null}
              {statusLabel ? <span className="text-fg-tertiary">·</span> : null}
              <span className="text-fg-tertiary">
                Создано {rowData.createdAt.toLocaleDateString('ru-RU')}
              </span>
              <span className="text-fg-tertiary">·</span>
              <span className="text-fg-tertiary">
                Обновлено {rowData.updatedAt.toLocaleDateString('ru-RU')}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {/* Property'и */}
        <section aria-label="Свойства">
          <div className="space-y-2">
            {sortedProps.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                value={rowData.cells[property.id]}
                row={rowData}
                onChange={(v) => onUpdateCell(rowId, property.id, v)}
              />
            ))}
          </div>
        </section>

        {/* Содержимое (rich text) */}
        <section aria-label="Содержимое">
          <h3 className="mb-2 text-sm font-medium text-fg-secondary">
            Содержимое
          </h3>
          <PageContentEditor
            initialContent={rowData.pageContent}
            onChange={(json) => onUpdatePageContent(rowId, json)}
          />
        </section>

        {/* Заглушка комментариев */}
        <section aria-label="Комментарии">
          <h3 className="mb-2 text-sm font-medium text-fg-secondary">
            Комментарии
          </h3>
          <div className="rounded-md border border-dashed border-border-subtle bg-bg-subtle px-4 py-6 text-center text-sm text-fg-tertiary">
            Скоро будет в Фазе 2+
          </div>
        </section>

        {/* Заглушка истории */}
        <section aria-label="История изменений">
          <h3 className="mb-2 text-sm font-medium text-fg-secondary">
            История изменений
          </h3>
          <div className="rounded-md border border-dashed border-border-subtle bg-bg-subtle px-4 py-6 text-center text-sm text-fg-tertiary">
            История изменений — в разработке
          </div>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────── PropertyRow ─────────────────────────────────

interface PropertyRowProps {
  property: TablePropertyDomain;
  value: unknown;
  row: TableRowDomain;
  onChange: (v: unknown) => void;
}

function PropertyRow({ property, value, row, onChange }: PropertyRowProps) {
  const isSupported = FAZA1_SUPPORTED_TYPES.has(property.type);
  const isComputed = COMPUTED_TYPES.has(property.type);
  // Read-only attribute-колонка (значение из памяти компании) — приоритетнее
  // inline-редактируемости: даже text/email/phone не должны иметь редактор.
  const isReadonlyAttr = isReadonlyProperty(property);
  const isInlineEditable =
    !isReadonlyAttr &&
    isSupported &&
    !isComputed &&
    ALLOWED_INLINE_TYPES.has(property.type);

  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-subtle/50">
      <div className="pt-1.5 text-xs text-fg-tertiary">
        <div className="flex items-center gap-1">
          {isReadonlyAttr ? (
            <Link2
              className="h-3 w-3 shrink-0 text-fg-tertiary"
              aria-hidden
            />
          ) : null}
          <span className="truncate" title={property.name}>
            {property.name}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-disabled">
          {PROP_TYPE_LABEL_RU[property.type]}
        </div>
      </div>

      <div className="min-w-0">
        {isReadonlyAttr ? (
          // Значение приходит из памяти компании — только отображение, без
          // редактора. Иконка-«звено» + подсказка поясняют, почему.
          <div
            className="flex min-h-9 items-center gap-1.5 px-2 py-1.5 text-sm"
            title={READONLY_HINT}
          >
            <span className={value ? 'text-fg-secondary' : 'text-fg-tertiary'}>
              {formatCellValue(value, property.type) || '—'}
            </span>
            <Link2
              className="h-3 w-3 shrink-0 text-fg-tertiary"
              aria-label={READONLY_HINT}
            />
          </div>
        ) : !isSupported ? (
          <ReadOnlyText text="Тип пока не поддерживается" muted />
        ) : isComputed ? (
          <ComputedDisplay property={property} row={row} />
        ) : isInlineEditable ? (
          <InlineEditor property={property} value={value} onChange={onChange} />
        ) : (
          // status / selectSingle / selectMulti / person / date — read-only
          // отображение через formatCellValue. Полноценный popover-редактор
          // будет добавлен позже (переиспользует Grid-логику).
          <ReadOnlyText
            text={formatCellValue(value, property.type) || '—'}
            muted={!value}
          />
        )}
      </div>
    </div>
  );
}

function ReadOnlyText({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div
      className={
        muted
          ? 'min-h-9 px-2 py-1.5 text-sm text-fg-tertiary'
          : 'min-h-9 px-2 py-1.5 text-sm text-fg-primary'
      }
    >
      {text}
    </div>
  );
}

function ComputedDisplay({
  property,
  row,
}: {
  property: TablePropertyDomain;
  row: TableRowDomain;
}) {
  let display: string;
  if (property.type === 'createdAt') display = row.createdAt.toLocaleString('ru-RU');
  else if (property.type === 'updatedAt') display = row.updatedAt.toLocaleString('ru-RU');
  else display = row.createdBy;
  return <ReadOnlyText text={display} muted />;
}

// ─────────────────────────── InlineEditor ────────────────────────────────

interface InlineEditorProps {
  property: TablePropertyDomain;
  value: unknown;
  onChange: (v: unknown) => void;
}

function InlineEditor({ property, value, onChange }: InlineEditorProps) {
  // Локальное состояние для свободного ввода — синхронизируется со store через
  // onChange. Store у себя debounce'ит PATCH.
  switch (property.type) {
    case 'checkbox': {
      const checked = Boolean(value);
      return (
        <div className="flex min-h-9 items-center px-2">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onChange(Boolean(v))}
            aria-label={property.name}
          />
        </div>
      );
    }

    case 'longtext': {
      return (
        <Textarea
          defaultValue={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="text-sm"
          placeholder="Введите текст"
        />
      );
    }

    case 'number':
    case 'currency':
    case 'percent': {
      const display =
        typeof value === 'number' || typeof value === 'string'
          ? String(value)
          : '';
      return (
        <Input
          type="number"
          defaultValue={display}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') onChange(null);
            else {
              const n = Number(v);
              onChange(Number.isFinite(n) ? n : null);
            }
          }}
          className="text-sm"
          step="any"
          placeholder="0"
        />
      );
    }

    case 'url':
    case 'email':
    case 'phone':
    case 'text':
    default: {
      const display = typeof value === 'string' ? value : '';
      const inputType =
        property.type === 'url'
          ? 'url'
          : property.type === 'email'
            ? 'email'
            : property.type === 'phone'
              ? 'tel'
              : 'text';
      return (
        <Input
          type={inputType}
          defaultValue={display}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
          placeholder="Введите значение"
        />
      );
    }
  }
}

// ─────────────────────────── Tiptap editor ───────────────────────────────

interface PageContentEditorProps {
  initialContent: Record<string, unknown> | null;
  onChange: (json: Record<string, unknown> | null) => void;
}

function PageContentEditor({ initialContent, onChange }: PageContentEditorProps) {
  // Дебаунс onUpdate, чтобы не вызывать store-PATCH на каждый кейстрок —
  // store сам тоже debounce'ит, но это убирает нагрузку на zustand-рендеры.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content:
      initialContent && typeof initialContent === 'object'
        ? initialContent
        : { type: 'doc', content: [{ type: 'paragraph' }] },
    // SSR-safe (React 19 / Next 16 App Router) — Tiptap инициализируется только
    // на клиенте. См. https://tiptap.dev/docs/editor/getting-started/install/react
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // Tailwind-стили без `@tailwindcss/typography` — задаём базовый
        // ритм заголовков/списков/цитат локальными классами `tt-prose`
        // (определены ниже в <style jsx> внутри компонента).
        class:
          'tt-prose min-h-[200px] w-full rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent',
      },
    },
    onUpdate: ({ editor: e }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const json = e.getJSON() as Record<string, unknown>;
        onChangeRef.current(json);
      }, 300);
    },
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!editor) {
    // SSR / первый рендер — Tiptap ещё не инициализирован.
    return (
      <div className="min-h-[200px] w-full rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm text-fg-tertiary">
        Загрузка редактора...
      </div>
    );
  }

  return (
    <div>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
      <TiptapStyles />
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);

  // Перерисовываем кнопки при изменении selection / formatting state.
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  const onLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Адрес ссылки', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="mb-1 flex flex-wrap items-center gap-0.5 rounded-md border border-border-subtle bg-bg-subtle px-1 py-1">
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Жирный"
        icon={<Bold className="h-3.5 w-3.5" />}
      />
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Курсив"
        icon={<Italic className="h-3.5 w-3.5" />}
      />
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Зачёркнутый"
        icon={<Strikethrough className="h-3.5 w-3.5" />}
      />
      <Divider />
      <ToolbarButton
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        label="Заголовок 1"
        icon={<Heading1 className="h-3.5 w-3.5" />}
      />
      <ToolbarButton
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Заголовок 2"
        icon={<Heading2 className="h-3.5 w-3.5" />}
      />
      <Divider />
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Маркированный список"
        icon={<List className="h-3.5 w-3.5" />}
      />
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Нумерованный список"
        icon={<ListOrdered className="h-3.5 w-3.5" />}
      />
      <ToolbarButton
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Цитата"
        icon={<Quote className="h-3.5 w-3.5" />}
      />
      <Divider />
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={onLink}
        label="Ссылка"
        icon={<LinkIcon className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        active
          ? 'inline-flex h-7 w-7 items-center justify-center rounded bg-accent-muted text-accent transition-colors'
          : 'inline-flex h-7 w-7 items-center justify-center rounded text-fg-secondary transition-colors hover:bg-bg-overlay hover:text-fg-primary'
      }
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border-subtle" aria-hidden />;
}

/**
 * Минимальные стили для Tiptap-контента — `@tailwindcss/typography` в проекте
 * не подключён, поэтому задаём базовый ритм через scoped CSS.
 *
 * Цвета — через семантические токены проекта (var(--text-*)).
 */
const TIPTAP_CSS = `
      .tt-prose {
        line-height: 1.55;
      }
      .tt-prose:focus {
        outline: none;
      }
      .tt-prose p {
        margin: 0 0 0.6em 0;
      }
      .tt-prose p:last-child {
        margin-bottom: 0;
      }
      .tt-prose h1 {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0.75em 0 0.4em;
        line-height: 1.2;
        color: var(--text-primary);
      }
      .tt-prose h2 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0.6em 0 0.35em;
        line-height: 1.25;
        color: var(--text-primary);
      }
      .tt-prose h3 {
        font-size: 1.05rem;
        font-weight: 600;
        margin: 0.6em 0 0.3em;
        line-height: 1.3;
        color: var(--text-primary);
      }
      .tt-prose ul,
      .tt-prose ol {
        margin: 0 0 0.6em 1.25em;
        padding: 0;
      }
      .tt-prose ul {
        list-style: disc;
      }
      .tt-prose ol {
        list-style: decimal;
      }
      .tt-prose li {
        margin: 0.15em 0;
      }
      .tt-prose blockquote {
        border-left: 3px solid var(--border-strong);
        padding-left: 0.75em;
        margin: 0 0 0.6em 0;
        color: var(--text-secondary);
        font-style: italic;
      }
      .tt-prose code {
        font-family: var(--font-mono);
        font-size: 0.9em;
        background: var(--bg-subtle);
        padding: 0.1em 0.3em;
        border-radius: 3px;
      }
      .tt-prose pre {
        font-family: var(--font-mono);
        background: var(--bg-subtle);
        padding: 0.7em 0.9em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0 0 0.6em 0;
      }
      .tt-prose pre code {
        background: transparent;
        padding: 0;
      }
      .tt-prose a {
        color: var(--accent);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .tt-prose strong {
        font-weight: 600;
      }
      .tt-prose hr {
        border: 0;
        border-top: 1px solid var(--border-subtle);
        margin: 1em 0;
      }
`;

function TiptapStyles() {
  // Глобальные стили для Tiptap-контента. Используем обычный <style> без
  // styled-jsx — Next 16 App Router styled-jsx по умолчанию не активен,
  // а CSS-in-JS не нужен (один статический блок).
  return <style dangerouslySetInnerHTML={{ __html: TIPTAP_CSS }} />;
}
