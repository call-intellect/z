---
type: tz
status: done
feature: Фаза C — AI-оценка качества встречи + рекомендации руководителю
date: 2026-05-21
parent_tz: tz/2026-05-21-competitor-parity.md
depends_on:
  - tz/2026-05-21-phase-A-prompt-registry-admin.md (мягкая — промпт через registry, до A.1 — код-fallback; жёсткая — A.4 для регистрации `meeting-quality-score` taskType с 3 tier'ами)
covers_matrix_rows: [23, 24, 25, 26, 27, 28, 29, 30, 31, 46, 47, 50]
---

# ТЗ C: AI-оценка качества встречи + рекомендации руководителю

> **Это sub-TZ.** Зонтичный — [`competitor-parity`](2026-05-21-competitor-parity.md).
>
> **Контекст:**
> - FollowUp.tech и Таймлист дают AI-оценку качества встречи и рекомендации руководителю. У mymeet этого нет в явном виде. У Z этого нет.
> - Это дифференциатор: материал для «дашборда CEO» и часть истории про «AI-совет директоров».

---

## 1. Цель

После реализации C:
1. По каждой завершённой встрече рассчитывается `MeetingQualityScore` — общий балл 0–100 + по категориям + список рекомендаций.
2. Видит только хост (`Meeting.ownerId`) и Org-Admin (owner/admin). **Гости и участники-не-хосты не видят score** (см. зонтичный §9 риск «обижает»).
3. На дашборде Org — карточка «Средний score встреч за период» с трендом и разбивкой по `Meeting.type`.
4. Можно регенерировать score независимо от основного отчёта.
5. Можно отключить score для конкретного типа встречи (org-настройка), если он не нужен (например, для CustDev руководителю score не нужен).

---

## 2. Scope

### Входит в C

**Категории оценки** (всегда 5):
1. **preparation** — повестка озвучена в начале, цель встречи проговорена? (есть/нет)
2. **structure** — есть структура (повестка, обсуждение, итоги) или хаос?
3. **clarity** — однозначные формулировки vs «всё надо переделать», «как-то сделай»?
4. **outcomes** — есть конкретные решения с ответственными и сроками?
5. **engagement** — участники активны или один доминирует?

**Что считает LLM:**
- `overallScore` — 0..100 (взвешенное среднее категорий).
- `categories: { preparation: 0..100, structure, clarity, outcomes, engagement }`.
- `recommendations: [{ text: string, severity: 'info'|'warning'|'critical', category: string }]` — 3–7 рекомендаций «как сделать встречу лучше».
- `strengths: string[]` — 2–4 пункта того, что было хорошо.

**Где живёт:**
- Модель `MeetingQualityScore` (one-to-one с Meeting).
- Промпт `meeting-quality-score` через `PromptRegistry` (sub-TZ A) с code-fallback.
- Воркер `ai.quality-score` (или новый внутри `analyze.worker` как параллельный сабжоб).
- Org-настройка `OrgSettings.qualityScoreDisabledForTypes: MeetingType[]`.

### Не входит в C

- Сравнение score между встречами одного хоста («ты улучшился») — отдельная фаза.
- Бенчмарки по индустрии («средний sales-call в SaaS — 78») — нет данных.
- Score для гостей-фасилитаторов (внешний коуч проводит встречу) — пока только хост Org видит.
- Видео-аналитика (улыбки, кивки) — не делаем.

---

## 3. Структура и зависимости

```
C.1 Schema + воркер + промпт (1 день)
  ├── Prisma: MeetingQualityScore + OrgSettings.qualityScoreDisabledForTypes
  ├── промпт meeting-quality-score (через PromptRegistry; code-fallback)
  ├── BullMQ worker ai.quality-score
  └── enqueue из ai.analyze после ai_ready
        ↓
C.2 API + UI (1 день)
  ├── GET /meetings/:id/quality-score
  ├── POST /meetings/:id/quality-score/regenerate (хост)
  ├── PATCH /org/settings/quality-score (отключение типов)
  ├── UI виджет на странице результата (только хост/owner/admin)
  └── Org-дашборд: карточка «Средний score» + тренд по типу
```

**Зависит от:**
- мягко от sub-TZ A (промпт в registry). До A.1 — код-fallback из файла `backend/src/modules/ai/services/prompts/meeting-quality-score.ts`.
- В sub-TZ B (метрики поведения) — НЕ зависит, но если метрики есть, добавляем их в LLM-инпут как обогащение.

---

## 4. Схема БД

```prisma
model MeetingQualityScore {
  id                  String    @id @default(cuid())
  meetingId           String    @unique
  tenantId            String

  overallScore        Int       // 0..100
  preparationScore    Int       // 0..100
  structureScore      Int       // 0..100
  clarityScore        Int       // 0..100
  outcomesScore       Int       // 0..100
  engagementScore     Int       // 0..100

  recommendations     Json      // [{ text, severity, category }]
  strengths           Json      // [text]

  promptTemplateVersionId String?
  computedAt          DateTime  @default(now())

  meeting             Meeting   @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([tenantId, overallScore])
  @@index([tenantId, computedAt])
}

model OrgSettings {
  // ... существующие поля ...
  qualityScoreDisabledForTypes  MeetingType[]   @default([])
}

model Meeting {
  // ... существующие поля ...
  qualityScoreStatus  String?   // 'pending' | 'ready' | 'failed' | 'disabled'
}
```

`bun run prisma:push && bun run prisma:generate`.

---

## 5. Промпт `meeting-quality-score`

### 5.1. Структура

```
Ты — методолог-аналитик встреч. Оцени качество прошедшей встречи по 5 категориям (0–100) и дай руководителю рекомендации.

Тип встречи: {{meetingType}}
Длительность: {{durationMinutes}} мин
Количество участников: {{participantsCount}}

Транскрипт (фрагменты):
{{transcriptCondensed}}

Метрики поведения (если есть):
- Тишина: {{silencePercent}}%
- Индекс доминирования: {{dominanceIndex}}
- Топ-3 по времени говорения: {{topSpeakers}}

ОЦЕНИ ПО 5 КАТЕГОРИЯМ (0..100):

1. **preparation** — была ли озвучена повестка, проговорена ли цель встречи в первые 5 минут?
2. **structure** — есть ли структура (введение → обсуждение → итоги), или встреча хаотична?
3. **clarity** — конкретны ли формулировки решений, или общие «надо подумать», «как-то решим»?
4. **outcomes** — есть ли конкретные решения с ответственными и сроками?
5. **engagement** — активны ли все участники, или один доминирует, остальные молчат?

ВЕРНИ JSON по схеме:

{
  "overallScore": 0..100,
  "categories": {
    "preparation": 0..100,
    "structure": 0..100,
    "clarity": 0..100,
    "outcomes": 0..100,
    "engagement": 0..100
  },
  "recommendations": [
    { "text": "string на русском", "severity": "info|warning|critical", "category": "preparation|structure|clarity|outcomes|engagement" }
  ],
  "strengths": ["2-4 пункта того, что было хорошо, на русском"]
}

Все строки на русском. Тон — конструктивный, без оценочных суждений людей. Рекомендации — действия («Озвучить повестку в первые 5 минут»), а не диагнозы («Хост не подготовился»).
```

### 5.2. Code-fallback

В файле `backend/src/modules/ai/services/prompts/meeting-quality-score.ts`:
```ts
export const MEETING_QUALITY_SCORE_PROMPT = { ... };
export const SCHEMA = z.object({ ... });
```

После A.1 → seed в PromptTemplate.

### 5.3. Длина транскрипта

LLM-окно ограничено. Алгоритм для длинных встреч:
- ≤30 мин → весь транскрипт.
- 30..120 мин → первые 10 + последние 10 минут + 5 случайных фрагментов по 2 минуты.
- > 120 мин → первые 10 + последние 10 + 10 случайных фрагментов по 2 минуты.

### 5.4. Регистрация LLM-маршрута (обязательно по [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило))

Новый `LlmTaskType='meeting-quality-score'`. Регистрируется через `scripts/seed-llm-task-routes-phase-C.ts`.

Категория задачи: **средний reasoning + структурированный JSON** (анализ сжатого транскрипта + 5 категорий + рекомендации). По [playbook §11](../../docs/reference/llm-models-playbook.md#11-fallback-chain) подходит близко к `summary-v2` / `goal-alignment` цепочке.

| Tier | Provider | Model | maxDataClass | Обоснование |
|---|---|---|---|---|
| **primary** | `deepseek` | `deepseek-v4-pro` (thinking on) | internal | Качественный reasoning + структурированный output. Дефолт playbook'а для тяжёлых задач. С промо-скидкой до 31.05.2026 — ~$0.01 на встречу. |
| **secondary** | `openai-via-proxy` | `gpt-5.4` | internal | Через свою прокси, стабильный JSON, выше latency но проверенное качество. |
| **tertiary** | `ollama` | `qwen3.5:9b` | private | Качество reasoning хуже — допустимо для fallback'а «лучше что-то, чем ничего». На полном tertiary включается graceful-degradation: в `recommendations` добавляется флаг `degradedMode=true`, UI показывает badge «Оценка построена на local-модели, может быть менее точной». |

> ⚠ **Это только seed-пресет**, не зашитая цепочка. После применения seed эти три строки попадают в `LlmTaskRoute`. Дальше super_admin меняет их через `/admin/ai-models/meeting-quality-score` без релиза: ставит в primary любую модель (например, Claude Sonnet, если есть `ANTHROPIC_API_KEY`), меняет порядок, добавляет ещё provider'ов, запускает A/B. См. [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило).

Seed-script:
```ts
// scripts/seed-llm-task-routes-phase-C.ts
// Источник: docs/reference/llm-models-playbook.md §2.1 (summary-v2 reference) + §11 (heavyReasoning chain).
// meeting-quality-score — middle reasoning: оценить структурированно 5 категорий и сгенерировать рекомендации.
// Tertiary дегрейдит качество — обозначается флагом в output (см. §5.4 этого ТЗ).
await prisma.llmTaskRoute.createMany({
  data: [
    { taskType: 'meeting-quality-score', tier: 'primary',   provider: 'deepseek',         model: 'deepseek-v4-pro', priority: 0, maxDataClass: 'internal' },
    { taskType: 'meeting-quality-score', tier: 'secondary', provider: 'openai-via-proxy', model: 'gpt-5.4',         priority: 0, maxDataClass: 'internal' },
    { taskType: 'meeting-quality-score', tier: 'tertiary',  provider: 'ollama',           model: 'qwen3.5:9b',      priority: 0, maxDataClass: 'private'  },
  ],
});
```

---

## 6. Воркер `ai.quality-score`

### 6.1. Файл

`backend/src/modules/ai/workers/quality-score.worker.ts`.

### 6.2. Enqueue

Из `ai.analyze` после успешного завершения (статус `ai_ready`), если:
- `meeting.type` НЕ в `org.settings.qualityScoreDisabledForTypes`.
- `meeting.duration ≥ 3 минуты` (короче не считаем).

### 6.3. Обработка

```ts
async process(job) {
  const meeting = await this.prisma.meeting.findUniqueOrThrow({ ... include: { transcript, aiResult, behaviorMetrics } });

  if (meeting.duration < 180_000) {
    await this.markDisabled(meeting.id, 'too_short');
    return;
  }

  const resolved = await this.promptResolver.resolveForMeeting({
    tenantId: meeting.tenantId,
    meetingId: meeting.id,
    meetingType: meeting.type,
    taskType: 'meeting-quality-score',
  });

  const merged = await this.s3.fetchJson(meeting.transcript.mergedS3Url);
  const condensed = this.condense(merged, meeting.duration);

  const llmResult = await this.llmRouter.run({
    taskType: 'meeting-quality-score',
    input: { ... },
    dataClass: 'internal',
  });

  const parsed = QualityScoreSchema.parse(llmResult.output);

  await this.prisma.meetingQualityScore.upsert({
    where: { meetingId: meeting.id },
    create: { ...parsed, meetingId: meeting.id, tenantId: meeting.tenantId, promptTemplateVersionId: resolved.versionId },
    update: { ...parsed, computedAt: new Date() },
  });

  await this.prisma.meeting.update({ where: { id: meeting.id }, data: { qualityScoreStatus: 'ready' } });
}
```

### 6.4. Error handling

- Невалидный JSON → LLM-router retry. После 3 fail → `qualityScoreStatus='failed'`.
- LLM-cost > $0.30 на одну встречу → лог `warn`, в `AiUsageLog` уже сохраняется.

---

## 7. API

### 7.1. Endpoints

```
GET /api/v1/meetings/:id/quality-score
  Auth: только хост (Meeting.ownerId) или Org-Admin
  Response 200: полный объект | 404 если pending/failed/disabled

POST /api/v1/meetings/:id/quality-score/regenerate
  Auth: хост или Org-Admin
  Rate-limit: 3 в час на meeting
  Response 202 + jobId

PATCH /api/v1/org/settings/quality-score
  Auth: owner / admin
  Body: { disabledForTypes: MeetingType[] }
  Response 200: обновлённые настройки

GET /api/v1/org/dashboard/quality-score?from=<ISO>&to=<ISO>&meetingType=<MeetingType?>
  Auth: owner / admin
  Response 200:
  {
    averageScore: number,
    meetingsCount: number,
    byType: [{ type: MeetingType, avg: number, count: number }],
    trend: [{ date: ISO, avg: number, count: number }]  // по дням/неделям
  }
```

### 7.2. RBAC

- Хост (`Meeting.ownerId === currentUserId`) — видит свой score.
- Org-Admin (owner/admin) — видит score всех встреч Org.
- Z-Admin (super_admin) — везде.
- Гость → 403.
- Member Org (не хост и не админ) → 403 (даже если был участником).

---

## 8. Frontend

### 8.1. Страница результата встречи

Внутри `/meetings/[id]/result`, ПОСЛЕ блока «AI-отчёт», ПЕРЕД «Поведение участников» — секция «Оценка качества встречи»:

- Только для хоста и Org-Admin (на бэке проверяем, в UI скрываем).
- Pending → skeleton.
- Disabled (`qualityScoreStatus='disabled'`) → не показываем вообще секцию.
- Failed → empty state «Не удалось рассчитать. [Перезапустить]».
- Ready:
  - Большой балл (0–100) с цветом (red 0-39, yellow 40-69, green 70-100).
  - 5 категорий с прогресс-барами.
  - Список рекомендаций (icon по severity).
  - Strengths — небольшой блок с галочками.
  - Кнопка «Перезапустить оценку» (показывается с подсказкой «3 раза в час»).

### 8.2. Org-дашборд

В `/dashboard` (owner/admin) — карточка «Качество встреч»:
- Среднее за период.
- Тренд (line chart, неделя/месяц).
- Топ-3 типа встреч с наибольшим / наименьшим средним.
- Кнопка «Подробнее» → `/dashboard/quality-score` с разбивкой.

### 8.3. Настройки Org

`/admin/settings/meetings` (новая страница или в существующих):
- Чекбокс-список «Считать оценку качества для типов: [✓] team / [✓] standup / [ ] custdev / …».
- Сохранение → `PATCH /org/settings/quality-score`.

### 8.4. Локализация (русский)

В `second-brain/13_glossary/copy-strings.ru.md`:
- «Оценка качества встречи»
- «Подготовка» / «Структура» / «Чёткость формулировок» / «Итоги» / «Вовлечённость»
- «Рекомендации» (Информация / Внимание / Важно — для severity)
- «Что было хорошо»
- «Перезапустить оценку»
- «Качество встреч» (для дашборда)
- «Считать оценку для типов встреч»

---

## 9. Метрики и логи

### 9.1. Prometheus

```
z_quality_score_computed_total
z_quality_score_failed_total
z_quality_score_disabled_total{reason="too_short|org_setting"}
z_quality_score_regenerate_total
z_quality_score_avg{org_id=<...>}    # gauge, обновляется cron'ом раз в час
z_quality_score_llm_cost_usd
```

### 9.2. Логи

- `info` на успех (с overallScore).
- `warn` на failed.
- `info` на disabled-skip.

---

## 10. DoD

### Технические

- [ ] `bun run typecheck && lint && build` чистые.
- [ ] Unit-тесты на `condense()` (3 кейса: короткая, средняя, длинная встреча).
- [ ] Integration-тест на воркер: для фикстуры meeting → ready + строки в `MeetingQualityScore`.
- [ ] `bun run prisma:push` без warnings.

### Функциональные

- [ ] Для 5 пилотных встреч score рассчитан, ручная проверка адекватна (средний балл 60-80 для нормальной встречи, низкий для откровенно хаотичной).
- [ ] Хост видит свой score; не-хост получает 403; гость не видит секцию.
- [ ] Org-Admin меняет `qualityScoreDisabledForTypes`, новые встречи этого типа → `disabled`, секция скрыта.
- [ ] Регенерация: 3-й вызов в час → 429 Too Many Requests.
- [ ] Дашборд показывает агрегат, тренд по неделям.

### Документация

- [ ] `second-brain/01_projects/quality-score.md` создан.
- [ ] `data-model.md`, `module-map.md`, `ai-jobs.md`, `api-layer.md` обновлены.
- [ ] Глоссарий расширен.
- [ ] Рефлексия.

### Матрица прослеживаемости

- [ ] Строки 23–31 — все `[x]`.
- [ ] Строки 46, 47, 50 — `[x]` (seed-script с 3 уровнями + ссылка на playbook + smoke-test Ollama tertiary прошёл; degradedMode-флаг проставляется).

---

## 11. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Score обижает участников | высокая | Видим только хосту и Org-Admin'у (см. §7.2). Тон LLM-промпта — конструктивный, рекомендации = действия |
| LLM даёт нестабильный score (на одной встрече 50, на другой 80, хотя похожи) | средняя | Temperature=0.2 (детерминированно), Claude Sonnet (стабильнее DeepSeek). Регенерация даёт тот же score ±5 пунктов |
| Score становится главным KPI и руководитель давит на хостов | средняя | Документация Z: «score — для саморефлексии хоста, не для премий». Маркетинг-копи аккуратный |
| Длинные встречи → высокий cost | средняя | Condense-алгоритм (см. §5.3). Лимит на 1 встречу — $0.30 (warning), $0.50 (fail) |
| Несоответствие с метриками поведения (например, structure=90, но crosstalk=40%) | низкая | Включаем метрики в LLM-input как обогащение → LLM сам корректирует. После пилота — проверить корреляцию |

---

## 12. Открытые вопросы

1. **Score для встреч < 3 минут** — пока не считаем. Возможно, в будущем сделаем "score" просто «недостаточно данных».
2. **Score участникам (а не только хосту)** — пока нет, см. зонтичный риск.
3. **Личный тренд хоста (мой score за время)** — добавим в `/me/profile` после паритета.

---

## 13. Итог

_TBD после реализации._

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Prisma-модель `MeetingQualityScore` (schema.prisma:5446) + расширение `Meeting.qualityScoreStatus` + `OrgSettings.qualityScoreDisabledForTypes`.
- Воркер `backend/src/modules/ai/workers/quality-score.worker.ts` + spec.
- API-сервис: `backend/src/modules/quality-score/quality-score.service.ts`.
- LLM-route: `backend/scripts/seed-llm-task-routes-phase-C.ts` (3 tier: deepseek-pro/openai-via-proxy/ollama).
- Frontend: `frontend/src/ui/components/quality-score/MeetingQualityScoreSection.tsx` + дашборд-виджет `dashboard/widgets/QualityScoreWidget.tsx`.
- Org-настройка: `frontend/app/(authenticated)/settings/admin/meetings/MeetingsAdminSettingsClient.tsx`.
