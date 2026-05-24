---
type: tz
status: done
feature: Фаза E — Несколько AI-отчётов на одну встречу
date: 2026-05-21
parent_tz: tz/2026-05-21-competitor-parity.md
depends_on:
  - tz/2026-05-21-phase-A-prompt-registry-admin.md (жёсткая — нужна библиотека шаблонов для выбора + A.4 для регистрации dynamic taskType'ов)
covers_matrix_rows: [39, 40, 41, 42, 43, 44, 45, 46, 47, 50]
---

# ТЗ E: Несколько AI-отчётов на одну встречу

> **Это sub-TZ.** Зонтичный — [`competitor-parity`](2026-05-21-competitor-parity.md).
>
> **Контекст:** mymeet и FollowUp позволяют сгенерировать на одну запись несколько разных отчётов (по разным шаблонам). У Z пока — один `AiResult` по типу встречи + регенерация секции. Добавляем возможность создавать N отчётов с разными шаблонами на одну встречу.
>
> **Зависимость:** sub-TZ A должен быть как минимум на стадии A.1 завершён, чтобы шаблоны были в БД.

---

## 1. Цель

После реализации E:
1. На странице результата встречи появляется вкладка/секция «Отчёты» со списком созданных отчётов.
2. Кнопка «Добавить отчёт» открывает выбор из библиотеки шаблонов (системные + Org-шаблоны).
3. По нажатию — асинхронная генерация нового отчёта (`MeetingReport`), показывается прогресс.
4. **Primary-отчёт** (текущий `AiResult` под `Meeting.type`) остаётся как «основной», отображается первым с пометкой «Основной».
5. Каждый дополнительный отчёт можно перегенерировать, скачать, удалить.
6. Лимит на количество дополнительных отчётов на встречу зависит от тарифа.

---

## 2. Scope

### Входит в E

**Модель:**
- `MeetingReport` (one-to-many от Meeting).
- Primary `AiResult` остаётся как есть (legacy compat). Помечается как `kind='primary'` в новой view-логике.

**Backend:**
- `MeetingReportsController` с CRUD-ишными эндпоинтами + регенерация.
- `MeetingReportsService` — оркестратор: создание record'а → enqueue в `ai.custom-report` воркер → ожидание результата.
- Воркер `ai.custom-report` — отдельный, чтобы не блокировать primary-pipeline.
- Entitlement-проверка по тарифу.

**Frontend:**
- Вкладка «Отчёты» в странице результата встречи.
- Модалка «Добавить отчёт» с выбором шаблона.
- Карточка отчёта (preview + кнопки).
- Регенерация / удаление.

### Не входит в E

- Кросс-встречные отчёты (агрегат по нескольким встречам) — другая фича.
- Расписание «генерируй такой-то отчёт автоматически на все встречи типа X» — после паритета.
- Marketplace шаблонов (см. sub-TZ A §16) — отдельно.
- Кастомные параметры шаблона при генерации (например, «сделай короткий вариант») — после паритета.
- Сравнение двух отчётов в diff-режиме — не входит.
- Push-уведомление, что отчёт готов — только email + уведомление в UI.

---

## 3. Структура и зависимости

```
E.1 Schema + воркер (1 день)
  ├── Prisma: MeetingReport
  ├── BullMQ worker ai.custom-report
  ├── Reuse PromptResolverService (из A.1)
  ├── enqueue не автоматически (только on-demand)
  └── Идемпотентность по (meetingId + templateId + status='pending|running')
        ↓
E.2 API + UI (1-1.5 дня)
  ├── REST endpoints (см. §7)
  ├── UI: вкладка «Отчёты» в /meetings/[id]/result
  ├── Модалка добавления (выбор из библиотеки шаблонов)
  ├── Карточка отчёта (preview, regenerate, delete)
  └── Entitlement-гейт по тарифу
```

**Зависит от:** sub-TZ A на стадии A.1 (нужен `PromptTemplate` в БД + `PromptResolverService`).
**Блокирует:** ничего.

---

## 4. Схема БД

```prisma
enum MeetingReportStatus {
  pending     // в очереди
  running     // воркер обрабатывает
  ready       // готов
  failed      // ошибка
  archived    // soft-delete
}

model MeetingReport {
  id                      String              @id @default(cuid())
  meetingId               String
  tenantId                String
  promptTemplateId        String
  promptTemplateVersionId String              // снимок конкретной версии на момент генерации

  kind                    String              // 'primary' | 'additional'  (primary == AiResult; добавлен для удобства view)
  title                   String              // = PromptTemplate.name на момент генерации (снимок)

  status                  MeetingReportStatus  @default(pending)
  output                  Json?               // JSON-ответ LLM (структура зависит от шаблона)
  llmCostUsd              Decimal?            @db.Decimal(10, 4)
  llmDurationMs           Int?
  errorMessage            String?

  createdById             String
  createdAt               DateTime            @default(now())
  completedAt             DateTime?
  deletedAt               DateTime?

  meeting                 Meeting               @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  promptTemplate          PromptTemplate        @relation(fields: [promptTemplateId], references: [id])
  promptTemplateVersion   PromptTemplateVersion @relation(fields: [promptTemplateVersionId], references: [id])

  @@index([meetingId, status])
  @@index([tenantId, createdAt])
  @@unique([meetingId, promptTemplateId, status], name: "no_duplicate_pending_per_template")  // частичный уникальный (через @@index с where в Prisma это не поддерживается — делаем через manual SQL в apply-postgres-init)
}

model Meeting {
  // ...
  customReports MeetingReport[]
}
```

> **Важно:** для guard'а от дублей `(meetingId, promptTemplateId, status='pending'|'running')` Prisma не поддерживает partial unique index напрямую. Создаём его через `apply-postgres-init.sql`:
> ```sql
> CREATE UNIQUE INDEX IF NOT EXISTS meeting_report_pending_unique
>   ON meeting_reports (meeting_id, prompt_template_id)
>   WHERE status IN ('pending', 'running');
> ```

`bun run prisma:push && bun run prisma:generate && bun run apply-postgres-init`.

---

## 5. Воркер `ai.custom-report`

### 5.1. Файл

`backend/src/modules/ai/workers/custom-report.worker.ts`.

### 5.2. Поток

```ts
async process(job: Job<{ meetingId: string; meetingReportId: string; tenantId: string }>) {
  const report = await this.prisma.meetingReport.findUniqueOrThrow({ where: { id: job.data.meetingReportId }, include: { promptTemplateVersion: { include: { sections: true, template: true } }, meeting: { include: { transcript: true } } } });

  if (report.status === 'ready' || report.status === 'archived') return; // idempotent

  await this.prisma.meetingReport.update({ where: { id: report.id }, data: { status: 'running' } });

  const merged = await this.s3.fetchJson(report.meeting.transcript!.mergedS3Url);
  const renderedPrompt = renderPromptFromTemplate(report.promptTemplateVersion, merged);

  try {
    const llmResult = await this.llmRouter.run({
      taskType: `custom-report:${report.promptTemplateVersionId}`,
      input: renderedPrompt,
      dataClass: 'internal',
    });

    const parsedOutput = parseLlmOutput(llmResult, report.promptTemplateVersion.outputSchema);

    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: {
        status: 'ready',
        output: parsedOutput,
        llmCostUsd: new Prisma.Decimal(llmResult.costUsd),
        llmDurationMs: llmResult.durationMs,
        completedAt: new Date(),
      },
    });

    this.metrics.increment('z_meeting_report_generated_total');
  } catch (err) {
    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: { status: 'failed', errorMessage: String(err) },
    });
    this.metrics.increment('z_meeting_report_failed_total');
    throw err;
  }
}
```

### 5.3. Очередь

`ai.custom-report`, concurrency=2. Retry 3x с backoff, после fail → status='failed'.

### 5.4. Cost guard

Cost-limit на один отчёт: $0.50. Если LLM-cost превышает → abort + status='failed' с `errorMessage='cost_limit'`. На уровне `LlmRouterService` или прерывание после результата (если стоимость считается после) — реализация зависит от текущего поведения роутера.

### 5.5. Регистрация LLM-маршрута (обязательно по [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило))

**Особенность E:** taskType'ы динамические — каждый шаблон создаёт свой `custom-report:<promptTemplateVersionId>` или общий `custom-report`. Нужно решение:

**Решение:** один **общий** `LlmTaskType='custom-report'` для всех дополнительных отчётов. Цепочка моделей одна на все шаблоны (потому что они работают с одинаковым типом контента — транскрипт встречи). Если Org-Admin хочет особую цепочку для своего шаблона — это **через A/B-эксперимент в `/admin/ai-models`**, не через создание нового taskType.

Регистрируется через `scripts/seed-llm-task-routes-phase-E.ts`.

Категория задачи: **средний reasoning + структурированный JSON** под пользовательский шаблон (до 30 разделов). Сложность зависит от шаблона — выбираем универсальную цепочку «как у primary-отчёта по типу встречи» из playbook.

| Tier | Provider | Model | maxDataClass | Обоснование |
|---|---|---|---|---|
| **primary** | `deepseek` | `deepseek-v4-flash` | internal | Универсальная цепочка из playbook §2.1 для `summary` + `card-rollup-v2`. Хорошее соотношение качество/цена. |
| **secondary** | `openai-via-proxy` | `gpt-5.4-mini` | internal | Через прокси, дороже но стабильнее на длинных промптах с 30 разделами. |
| **tertiary** | `ollama` | `qwen3.5:9b` | private | Местный фолбэк. На 30-секционных промптах качество хуже — degradedMode-флаг в `MeetingReport.output.warnings[]`, UI badge. |

> ⚠ **Это только seed-пресет**, не зашитая цепочка. После применения seed эти три строки попадают в `LlmTaskRoute`. Дальше super_admin меняет их через `/admin/ai-models/custom-report` без релиза. Особенность E: можно создать **отдельный taskType per-шаблон** (`custom-report:<promptTemplateVersionId>`) через UI — кнопка «Привязать особую цепочку моделей к этому шаблону» в `/admin/prompts/[id]`. Это создаёт override-запись в `LlmTaskRoute` с более узким `taskType` (резолвер берёт более специфичный, если есть). См. [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило).

Seed-script:
```ts
// scripts/seed-llm-task-routes-phase-E.ts
// Источник: docs/reference/llm-models-playbook.md §2.1 (generalPurpose chain).
// custom-report — универсальный taskType для всех дополнительных отчётов.
// Per-шаблон цепочки = через A/B-эксперимент в /admin/ai-models, не отдельный taskType.
await prisma.llmTaskRoute.createMany({
  data: [
    { taskType: 'custom-report', tier: 'primary',   provider: 'deepseek',         model: 'deepseek-v4-flash', priority: 0, maxDataClass: 'internal' },
    { taskType: 'custom-report', tier: 'secondary', provider: 'openai-via-proxy', model: 'gpt-5.4-mini',      priority: 0, maxDataClass: 'internal' },
    { taskType: 'custom-report', tier: 'tertiary',  provider: 'ollama',           model: 'qwen3.5:9b',        priority: 0, maxDataClass: 'private'  },
  ],
});
```

**Cost guard учитывает tier:** при работе через primary лимит $0.50; при fallback на tertiary (Ollama, $0) — без cost-guard'а, но с timeout 5 минут.

---

## 6. Primary vs additional

**Решение зонтика (Q5):** primary == `AiResult` под `Meeting.type`, его НЕ трогаем legacy-wise.

В новом API:
- `GET /meetings/:id/reports` возвращает **всегда** "primary" + список additional из `MeetingReport`.
- Primary — синтетический объект с `kind='primary'`, источник = `AiResult` + связь с `PromptTemplate` через `AiResult.promptTemplateVersionId` (введён в sub-TZ A).
- additional — записи `MeetingReport`.

UI отображает их в одном списке. Primary всегда первый, помечен бейджем «Основной». Кнопка «Удалить» disabled для primary.

```ts
// Backend response shape
type ReportListItem = {
  kind: 'primary' | 'additional';
  id: string;                         // для primary — это AiResult.id; для additional — MeetingReport.id
  meetingId: string;
  templateId?: string;                // для primary — может быть null (если до A не было)
  templateName: string;
  status: 'ready' | 'pending' | 'running' | 'failed';
  outputPreview?: string;             // первые 200 символов summary
  createdAt: string;                  // ISO
  completedAt?: string;
  llmCostUsd?: number;
};
```

---

## 7. API

### 7.1. Endpoints

```
GET /api/v1/meetings/:id/reports
  Auth: хост / member Org / share-token с allowReports
  Response 200: [{ ReportListItem }, ...]  // primary + additional, primary первым

POST /api/v1/meetings/:id/reports
  Auth: хост или Org-Admin
  Body: { templateId: string }            // выбранный шаблон (system или org)
  Rate-limit: 10 reports per meeting (общий лимит); см. также entitlement
  Response 202: { id, status: 'pending' } | 409 если уже есть pending/running по этому templateId

GET /api/v1/meetings/:id/reports/:reportId
  Auth: как list
  Response 200: { ...полный объект включая output }

POST /api/v1/meetings/:id/reports/:reportId/regenerate
  Auth: хост или Org-Admin
  Rate-limit: 3/час per report
  Body: { useVersionId?: string }  // опционально — конкретная версия шаблона; иначе activeVersion
  Response 202

DELETE /api/v1/meetings/:id/reports/:reportId
  Auth: хост или Org-Admin
  Response 204 (soft-delete, status='archived', deletedAt=now())
```

### 7.2. Entitlement-гейт

Расширить `EntitlementFeature`:
- `multi_reports_per_meeting` — boolean
- `multi_reports_limit_per_meeting` — int (5, 20, 100)

| Тариф | Multi-reports | Лимит на встречу |
|---|---|---|
| Free / Starter | ❌ | 0 (нельзя) |
| Pro | ✅ | 5 |
| Business | ✅ | 20 |
| Enterprise | ✅ | 100 |

### 7.3. Поведение primary при отсутствии PromptTemplate

Если `AiResult.promptTemplateVersionId` null (старая встреча до sub-TZ A) — primary всё равно показывается с `templateName = 'Системный шаблон ' + meeting.type` (default-русский label).

---

## 8. Frontend

### 8.1. Страница `/meetings/[id]/result`

Новая вкладка «Отчёты» внутри master-detail layout (если такого нет — добавляем секцию ПЕРЕД «Транскрипт»):
- Список карточек (primary первый).
- Кнопка «+ Добавить отчёт» (disabled для тарифов без entitlement; tooltip «Доступно на Pro/Business»).

### 8.2. Карточка отчёта

```
┌─────────────────────────────────────────┐
│ 📝 Sales Coach                  [Основной] │   <- если primary
│ Сгенерирован 12.05.2026 в 14:30          │
│                                          │
│ Превью: «Клиент заинтересован в покупке…»│
│                                          │
│ [Открыть] [Перегенерировать]            │
└─────────────────────────────────────────┘
```

Для additional — кнопка «Удалить» доступна (с confirmation).

### 8.3. Модалка «Добавить отчёт»

- Заголовок «Выберите шаблон для нового отчёта».
- Tabs: «Системные» / «Мои шаблоны».
- Grid с карточками шаблонов (название + описание + meta «для X типа встреч»).
- При выборе — внизу кнопка «Сгенерировать».
- После клика — POST на `/reports`, модалка закрывается, в списке появляется новая карточка со status=pending.

### 8.4. Просмотр полного отчёта

Клик на карточку открывает страницу `/meetings/[id]/reports/[reportId]` или модальное окно с полным content.

### 8.5. Локализация

Добавить в `delivery/ui/copy-strings.ru.md`:
- «Отчёты» / «Добавить отчёт»
- «Основной» (badge для primary)
- «Выберите шаблон для нового отчёта»
- «Сгенерировать» / «Перегенерировать» / «Удалить отчёт»
- «Подготовка отчёта…» / «Готов» / «Не удалось сгенерировать»
- «Доступно на Pro / Business» (для entitlement-disabled)
- «Удалить отчёт? Это действие нельзя отменить.» (confirmation)

### 8.6. SWR-инвалидация

При POST/regenerate/delete — `mutate('/meetings/:id/reports')` для refresh.

### 8.7. Polling статусов

Если в списке есть `pending` или `running` — SWR refresh каждые 5 сек (через `revalidateOnFocus` + `refreshInterval: 5000` пока есть такие записи).

---

## 9. Метрики и логи

### 9.1. Prometheus

```
z_meeting_report_created_total{kind="additional"}
z_meeting_report_generated_total
z_meeting_report_failed_total{reason="llm_error|cost_limit|other"}
z_meeting_report_regenerated_total
z_meeting_report_deleted_total
z_meeting_report_duration_seconds (histogram)
z_meeting_report_llm_cost_usd                 # counter
z_meeting_report_count_per_meeting (histogram, для аналитики "сколько в среднем reports на встречу")
```

### 9.2. Логи

- `info` на create / generation / regenerate / delete (с meetingId, templateId, status).
- `warn` на cost-limit hit.
- `error` на failure.

---

## 10. DoD

### Технические

- [ ] `bun run typecheck && lint && build` чистые.
- [ ] `bun run prisma:push && bun run apply-postgres-init` без warnings (включая partial unique index).
- [ ] Unit-тесты на `MeetingReportsService`: create / regenerate / delete.
- [ ] Integration-тест на воркер: создать MeetingReport → воркер обработал → status=ready, output есть.
- [ ] Тест на partial unique: вторая попытка create с тем же templateId при существующем pending → 409.

### Функциональные

- [ ] Создать MeetingReport с template из библиотеки → асинхронная генерация → status=ready, отчёт виден в списке.
- [ ] Регенерация: status=pending → ready, новый output, llmCostUsd обновлён.
- [ ] Удаление: status=archived, в списке не виден.
- [ ] Primary `AiResult` отображается первым в `GET .../reports`, помечен `kind='primary'`.
- [ ] Free-тариф: кнопка disabled; запрос POST → 403.
- [ ] Pro-тариф: 5 additional максимум; 6-й → 403 с message «Лимит на Pro — 5 отчётов на встречу».
- [ ] Cost-limit $0.50 на отчёт срабатывает (синтетический тест с большим контекстом).

### Документация

- [ ] `second-brain/01_projects/multi-reports.md`.
- [ ] `data-model.md`, `module-map.md`, `ai-jobs.md`, `api-layer.md` обновлены.
- [ ] Глоссарий расширен.
- [ ] Рефлексия.

### Матрица прослеживаемости

- [ ] Строки 39–45 — все `[x]`.
- [ ] Строки 46, 47, 50 — `[x]` (общий `custom-report` taskType зарегистрирован с 3 tier'ами, ссылка на playbook есть, tertiary smoke-test прошёл; degradedMode-флаг проставляется).

---

## 11. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Пользователь спамит regenerate, разоряя Org на LLM-cost | высокая | Rate-limit 3/час на report + cost-limit $0.50 + entitlement-лимит общего количества |
| Primary и additional путают пользователя («где основной отчёт?») | средняя | Бейдж «Основной» + первая позиция в списке + tooltip «Сгенерирован автоматически по типу встречи». Кнопка удаления заблокирована для primary |
| Если шаблон удалён, а отчёт по нему остался | низкая | `MeetingReport.promptTemplateVersionId` сохраняет снимок версии. Удаление шаблона — soft (deletedAt), отчёт продолжает работать |
| Несогласованность output-schema у разных шаблонов → frontend не знает как рендерить | критичная | UI рендерит динамически по `output` структуре + `PromptTemplateSection[].outputType`. Дефолтный fallback — JSON-pretty-print |
| Лимит 100 reports на встречу (Enterprise) затопит UI | низкая | Pagination: SWR с лимитом 20 на page + кнопка «Показать ещё». Уведомление если ≥50 reports |
| Cost-counter в LlmRouter измеряет cost ПОСЛЕ генерации (нельзя прервать) | средняя | Pre-check: оценить токены input ≤ 10k → если больше, abort до вызова. Post-check: если LLM вернул дороже $0.50 — лог `warn`, но отчёт всё равно сохраняется (юзер уже потратил) |

---

## 12. Открытые вопросы

1. **Уведомление «отчёт готов» в UI** — toast? E-mail? Пока — toast при следующем visit на страницу. Email — после паритета.
2. **Можно ли удалить primary AiResult?** Нет, primary удаляется только при удалении Meeting.
3. **Экспорт отчёта в PDF/DOCX?** Не входит в E, есть отдельный модуль `exports/`. Можно использовать existing → передать `MeetingReport.output` как content.
4. **Шаринг конкретного report через MeetingShare?** Пока — нет; share-токен открывает primary. После паритета — добавим `MeetingShare.reportIds[]`.

---

## 13. Итог

_TBD после реализации._

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Prisma-модель `MeetingReport` (schema.prisma:4986) + enum `MeetingReportStatus`.
- Модуль `backend/src/modules/meeting-reports/`: `meeting-reports.{module,service,controller}.ts` + `dto/meeting-reports.dto.ts` + `meeting-reports.service.spec.ts`.
- Воркер `backend/src/modules/ai/workers/custom-report.worker.ts` + spec.
- LLM-route: `backend/scripts/seed-llm-task-routes-phase-E.ts` (3 tier: deepseek-flash/gpt-5.4-mini/ollama, taskType=`custom-report`).
- Frontend: `frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx` — вкладка «Отчёты» с primary + additional, в `MeetingResultPageReal`.
