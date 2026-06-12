---
type: tz
status: ready-to-implement
feature: meeting-report-copy-download-actions
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/tz/2026-06-06-meeting-report-reliability-and-ui-honesty.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §6 (UX отчёта) · бриф §ТЗ-5 · Статус согласования: decisive.
> Цель в одну строку: дать в отчёте встречи **«Скопировать текст» и «Скачать»** и сделать отчёт **виден целиком на странице** — переиспользуя уже готовый человекочитаемый рендер `structured-report.tsx` (reliability Ф5).

---

## 1. Цель и зачем (человеческим языком)

**Запрос владельца.** Отчёт должен быть **виден подробно** (читаться на странице, не только в модалке) и его текст нужно **скачать или хотя бы скопировать**.

**Что сейчас (факт).** «Открыть» основного отчёта поднимает модалку (`ReportDetailDialog`) с человекочитаемым контентом ([ReportsTab.tsx:475-501](../../frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx#L475-L501)), но **внутри только «Закрыть»** — нет «Скопировать»/«Скачать». В шапке страницы есть «Скачать»/«Поделиться», но это про страницу/запись, не про конкретный текстовый отчёт. Отчёт уже рендерится инлайн в «Обзоре» (`StructuredDataCard`, [MeetingResultPageReal.tsx:944,987](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L944)), но без действий копирования/скачивания.

**Чем решение лучше.** Один сериализатор `structuredData → markdown/текст` (реюз русских заголовков из `structured-report.tsx`) + общий блок действий «Скопировать / Скачать / Печать» в диалоге И в «Обзоре». Владелец забирает текст отчёта одним кликом. Минимально — без новых зависимостей (PDF = печать браузера, скачивание = `Blob` как в `AdminCsvDownloadButton`).

---

## 2. REALITY-CHECK (что по факту в коде)

| Проверено | Факт | Источник |
|---|---|---|
| Человекочитаемый рендер — УЖЕ есть | `structured-report.tsx` (reliability Ф5): `STRUCTURED_FIELD_LABELS`, `structuredFieldLabel`, `StructuredFieldValue`, `objectMainText`/`objectMeta`, `isEmptyStructuredValue` | [structured-report.tsx:9-123](../../frontend/src/ui/components/meeting-result-v2/structured-report.tsx#L9-L123) |
| Отчёт инлайн в «Обзоре» — УЖЕ есть | `<StructuredDataCard data={structuredData}/>` под видео (вкладка «Обзор») | [MeetingResultPageReal.tsx:944,987-1003](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L944) |
| Диалог отчёта без действий | `ReportDetailDialog` → `ReportOutputRenderer output={data.output}` + только «Закрыть» | [ReportsTab.tsx:490-499](../../frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx#L490-L499) |
| Копирование — готовый хелпер | `copyToClipboard(text)` (ловит NotAllowedError/insecure context) | [copy-to-clipboard.ts:8](../../frontend/src/lib/copy-to-clipboard.ts#L8) |
| Скачивание — готовый паттерн | `Blob` + `URL.createObjectURL` + клик по скрытой ссылке | [AdminCsvDownloadButton.tsx:50](../../frontend/src/ui/components/admin/AdminCsvDownloadButton.tsx#L50) |
| Тост | `import { toast } from 'sonner'` (новый; `useToast` устарел) | [toast-context.tsx:50](../../frontend/src/contexts/toast-context.tsx#L50) |
| Тест-файл модуля есть | `__tests__/structured-report.test.ts` — туда тест сериализатора | [structured-report.test.ts](../../frontend/src/ui/components/meeting-result-v2/__tests__/structured-report.test.ts) |

**Следствие:** «развёрнутый просмотр под видео» в основном УЖЕ закрыт «Обзором» (reliability Ф5) — НЕ строить редундантный аккордеон. Остаётся: сериализатор + общий блок действий в диалоге и «Обзоре». Реюз хелперов клипборда/скачивания — без новых зависимостей.

---

## 3. Доказательство выбора (кратко, challenge-loop)

| Решение | A | B | Выбор · почему |
|---|---|---|---|
| Источник текста для копи/скачать | **сериализатор из `structuredData` (реюз labels)** | бэкенд отдаёт готовый markdown отдельным полем | **A** — фронт уже знает структуру (`ReportOutputRenderer`), бэкенд не трогаем; нет нового контракта |
| PDF | **печать браузера (`window.print`)** | подключить pdf-библиотеку | **A** — без новой зависимости (минимально); .md/.txt покрывают «скачать текст» |
| Развёрнутый просмотр | **реюз «Обзора» + добавить действия** | новый аккордеон «Отчёт целиком» | **A** — «Обзор» уже под видео и человекочитаем; новый блок = дубль (код ради кода) |

- *Корень?* Да — даём ровно то, что просил владелец (забрать текст + видеть целиком), переиспользуя готовое.
- *Эффективнее?* Да — сериализатор зеркалит уже существующий `ReportOutputRenderer`; клипборд/скачивание — готовые хелперы.
- *Кода ради кода?* Нет — не плодим новый просмотр (реюз «Обзора»), не добавляем pdf-либу.

---

## 4. Принятые решения (decisive)

| # | Решение | Почему |
|---|---|---|
| Р1 | **Сериализатор `structuredReportToMarkdown(output, title?)`** в `structured-report.tsx` — реюз `STRUCTURED_FIELD_LABELS`/`objectMainText`/`objectMeta`/`isEmptyStructuredValue`. | Один источник правды о тексте отчёта; зеркалит `ReportOutputRenderer`. |
| Р2 | **Общий `ReportActions`**: «Скопировать текст» (`copyToClipboard`+`toast`), «Скачать .md» (`Blob`), «Печать» (`window.print`). Без pdf-либы. | Минимально, без новых зависимостей; .md = текст отчёта, печать = «PDF». |
| Р3 | **Действия — в диалоге отчёта И в «Обзоре»** (рядом со `StructuredDataCard`). Новый аккордеон НЕ делаем. | «Обзор» уже даёт развёрнутый просмотр под видео; действия нужны там же и в модалке. |

> Развилок нет.

---

## 5. Scope
**Входит:** сериализатор (Р1); компонент `ReportActions` (Р2); подключение в `ReportDetailDialog` + `StructuredDataCard` (Р3).
**Не входит (vNext):** настоящий PDF-рендер с вёрсткой (печать покрывает); экспорт всей страницы (есть в шапке); редактирование отчёта; локализация англо-заголовков шаблонов (вне UX-действий).

---

## 6. Контракт (что именно поменять)

### 6.1 Сериализатор (Фаза 1) — `structured-report.tsx`
```ts
/** structuredData/output → markdown (зеркало ReportOutputRenderer): top-level → '## Заголовок' + значение. */
export function structuredReportToMarkdown(output: unknown, title?: string): string {
  if (output == null || typeof output !== 'object') return title ? `# ${title}\n\n${String(output ?? '')}` : String(output ?? '');
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, '');
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (isEmptyStructuredValue(value)) continue;
    lines.push(`## ${structuredFieldLabel(key)}`);
    lines.push(structuredValueToMarkdown(value));
    lines.push('');
  }
  return lines.join('\n').trim();
}
// structuredValueToMarkdown: массив строк → '- item'; массив объектов → '- {objectMainText} (— {objectMeta})';
//   вложенный объект → '**Подпись**: значение'; строка/число/булево → как есть. Реюз objectMainText/objectMeta.
export function structuredReportToPlainText(output: unknown, title?: string): string {
  return structuredReportToMarkdown(output, title).replace(/^#+\s*/gm, '').replace(/^\-\s*/gm, '• ');
}
```
Экспортировать оба + `structuredValueToMarkdown` (для теста).

### 6.2 `ReportActions` (Фаза 2) — новый компонент в `meeting-result-v2/`
```tsx
function ReportActions({ output, title }: { output: unknown; title?: string }) {
  const md = structuredReportToMarkdown(output, title);
  const onCopy = async () => { const ok = await copyToClipboard(md); toast[ok ? 'success' : 'error'](ok ? 'Текст отчёта скопирован' : 'Не удалось скопировать'); };
  const onDownload = () => { /* Blob([md],{type:'text/markdown'}) → createObjectURL → клик скрытой <a download=`${slug(title)}.md`> → revoke (паттерн AdminCsvDownloadButton) */ };
  const onPrint = () => window.print();
  // 3 кнопки (Button variant=secondary, lucide-иконки Copy/Download/Printer), русские подписи, парные токены.
}
```
Реюз `copyToClipboard` ([lib/copy-to-clipboard.ts](../../frontend/src/lib/copy-to-clipboard.ts)) и `toast` (sonner). Без `text-white`/hex.

### 6.3 Подключение (Фаза 3)
- [ReportsTab.tsx:495](../../frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx#L495) — в футер диалога (рядом с «Закрыть») добавить `<ReportActions output={data.output} title={data.templateName} />` (только когда `data` есть).
- [MeetingResultPageReal.tsx:987](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L987) — в шапку `StructuredDataCard` добавить `<ReportActions output={data} title="Отчёт встречи" />`.

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф: Ф1 (сериализатор) → Ф2 (компонент, зависит от Ф1) → Ф3 (подключение, зависит от Ф2). Последовательно.

### Фаза 1 — Сериализатор
Файлы: `structured-report.tsx`, `__tests__/structured-report.test.ts`.
**Acceptance:** юнит: `{tasks:[{title:'A',assignee:'Иван'}], decisions:['Б']}` → markdown содержит `## Задачи`, `- A`, `Иван`, `## Решения`, `- Б`; пустые секции (`blockers:[]`) пропущены; нет сырых англо-ключей/JSON. `bun run typecheck/lint/test:unit` зелёные.
Закрывает: R1.

### Фаза 2 — `ReportActions`
Файлы: `meeting-result-v2/ReportActions.tsx`(new).
**Acceptance:** грепы: `copyToClipboard`, `toast` (sonner), `Blob`/`createObjectURL`, `window.print`; 3 кнопки с русскими подписями «Скопировать текст»/«Скачать»/«Печать»; нет `text-white`/hex/`slate-`. `bun run typecheck/lint` зелёные.
Закрывает: R2.

### Фаза 3 — Подключение
Файлы: `ReportsTab.tsx`, `MeetingResultPageReal.tsx`.
**Acceptance:** грепы: `<ReportActions` в `ReportDetailDialog` и в `StructuredDataCard`. Ручная: в диалоге и «Обзоре» есть рабочие «Скопировать»(тост)/«Скачать»(.md файл)/«Печать». `bun run typecheck/lint/build` зелёные.
Закрывает: R3.

**Требования (EARS):**
- R1: Когда есть `structuredData`/`output` отчёта, система shall сериализовать его в markdown с русскими заголовками (зеркало `ReportOutputRenderer`), пропуская пустые секции.
- R2: Когда пользователь жмёт «Скопировать»/«Скачать»/«Печать», система shall скопировать текст (тост-подтверждение) / скачать `.md` / открыть печать.
- R3: Действия отчёта shall быть доступны и в диалоге отчёта, и в инлайн-«Обзоре» под видео.

---

## 8. Границы фичи
- ✅ Always: реюз `structured-report.tsx`/`copyToClipboard`/`toast`/download-паттерна; русские подписи; парные токены.
- ⚠️ Ask first: добавлять pdf-зависимость; новый просмотр-аккордеон.
- 🚫 Never: дублировать рендер отчёта; `text-white` на цветном; англо-подписи кнопок.

## 9. Совместимость с prompt caching
Не релевантно — фронтовый UX, LLM не задействован.

## 10. Риски / pre-mortem
| Риск | Митигация |
|---|---|
| `copyToClipboard` падает в insecure context | хелпер уже ловит NotAllowedError → тост «не удалось» |
| markdown-сериализация разной output-schema | сериализатор generic (как `ReportOutputRenderer`), пустые секции скрыты; юнит на 2-3 формы |
| `window.print` печатает всю страницу, не отчёт | приемлемо для MVP (печать «как есть»); print-CSS — vNext |

## 11. Idempotency / feature-flag / prod-deploy
- Только frontend, без ENV/схемы/seed → прод: деплой фронта. prod-deploy-log не требуется.
- Feature-flag не нужен (аддитивный UX).

## 12. DoD
- `bun run typecheck`(вкл `.spec`)/`lint`/`build`/`test:unit` (frontend) зелёные; юнит сериализатора.
- second-brain: `01_projects/frontend-pages.md` — действия отчёта (копировать/скачать/печать).
- Рефлексия в `05_история/`.

## Итог
_(заполнит tz-orchestrator: копирование/скачивание работают? отчёт виден целиком под видео?)_
