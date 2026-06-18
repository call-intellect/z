---
type: tz
status: done
feature: Фаза B — Метрики поведения участников встречи
date: 2026-05-21
parent_tz: tz/2026-05-21-competitor-parity.md
depends_on:
  - tz/2026-05-21-phase-A-prompt-registry-admin.md (A.4 — для регистрации `behavior-refine` taskType в LlmTaskRoute с 3 уровнями)
covers_matrix_rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 46, 47, 50]
---

# ТЗ B: Метрики поведения участников встречи

> **Это sub-TZ.** Зонтичный — [`competitor-parity`](2026-05-21-competitor-parity.md).
>
> **Контекст:**
> - mymeet.ai считает 40+ метрик поведения. FollowUp.tech — тональность + рекомендации. У Z этого нет.
> - У нас уже есть per-track audio (`AudioTrack`) для каждого участника + диаризация в Vox-ответе → данные для метрик уже лежат, нужно только вытащить.

---

## 1. Цель

После реализации B на странице результата встречи и в дашборде Org появляется секция «Поведение участников» с метриками: время говорения, монологи, вопросы, слова-паразиты, прерывания, тишина, crosstalk. Метрики считаются отдельным воркером `ai.behavior-metrics` параллельно `ai.analyze` и могут стать готовыми раньше/позже основного отчёта (UI должен корректно показывать оба состояния).

---

## 2. Scope

### Входит в B

**Метрики per-participant** (минимум 8):
1. `speakingTimeMs` — суммарное время речи в мс.
2. `speakingTimePercent` — доля от общего времени встречи.
3. `turnsCount` — количество «поворотов» (turn = непрерывный отрезок речи участника).
4. `avgTurnDurationMs` — средняя длительность turn.
5. `monologueCount` — количество turn'ов длительностью ≥ 60 секунд.
6. `longestMonologueMs` — самый длинный turn.
7. `questionCount` — кол-во вопросов (по знаку «?» в тексте после ASR + LLM-уточнение для пограничных).
8. `fillerWordsCount` — кол-во слов-паразитов (по словарю + LLM-уточнение).
9. `interruptionsMadeCount` — сколько раз участник заговорил, перебивая другого.
10. `interruptionsReceivedCount` — сколько раз перебивали участника.

**Метрики общего уровня** (минимум 6):
1. `totalDurationMs` — общая длительность встречи (из `Meeting.endedAt - startedAt`).
2. `totalSpeechMs` — суммарное время речи всех (учитывая crosstalk дважды).
3. `silenceMs` — суммарная тишина (ни один спикер не говорит).
4. `silencePercent` — доля тишины.
5. `crossTalkMs` — суммарное время одновременной речи 2+ участников.
6. `dominanceIndex` — нормированный индекс доминирования (топ-1 спикер / медиана), коэффициент 0..N.

**Где это живёт:**
- Новая модель `MeetingBehaviorMetrics` (one-to-one с Meeting) для общих + связанная `MeetingParticipantBehavior` (one-to-many).
- Новый воркер `ai.behavior-metrics` в `backend/src/modules/ai/workers/behavior-metrics.worker.ts`.
- API: `GET /meetings/:id/behavior-metrics`.
- UI: секция «Поведение участников» на странице результата + виджет на org-дашборде.

### Не входит в B

- Тональность / эмоция — отдельная задача, после паритета (нужен voice-based model, дорого).
- Live-метрики во время встречи (real-time coach) — после паритета.
- Метрики «качество вопросов» (открытые vs закрытые) — после паритета.
- Метрики на основе видео (взгляд, мимика) — не делаем, мы про audio-first.
- Сравнение с benchmarks (среднее по индустрии) — после паритета.

---

## 3. Структура и зависимости

```
B.1 Schema + воркер (детерминистский слой) (1.5 дня)
  ├── Prisma: MeetingBehaviorMetrics, MeetingParticipantBehavior
  ├── BehaviorMetricsCalculator (pure-функция из merged.json + tracks)
  ├── BullMQ worker ai.behavior-metrics
  ├── enqueue из ai.merge параллельно с ai.analyze
  └── unit-тесты на calculator (10+ кейсов: монолог, прерывание, тишина, crosstalk)
        ↓
B.2 LLM-надстройка (вопросы + filler-уточнение) (0.5 дня)
  ├── taskType 'behavior-refine' через LlmRouter
  ├── промпт: даём список «кандидатов на вопросы» и список «кандидатов на filler» → LLM подтверждает
  └── интеграция в калькулятор как опциональный step
        ↓
B.3 API + Frontend (1 день)
  ├── GET /meetings/:id/behavior-metrics
  ├── DTO + Zod + Swagger
  ├── UI секция на странице результата (расширение существующей)
  └── Org-aggregation: GET /org/behavior-metrics/aggregate (период, тип встречи)
```

**Зависит от:** ничего — данные (merged.json + AudioTrack) уже есть.
**Блокирует:** ничего — sub-TZ C может использовать эти метрики как input, но не обязан.

---

## 4. Схема БД

```prisma
model MeetingBehaviorMetrics {
  id                String   @id @default(cuid())
  meetingId         String   @unique
  tenantId          String

  totalDurationMs   Int
  totalSpeechMs     Int
  silenceMs         Int
  silencePercent    Float    // 0..100
  crossTalkMs       Int
  dominanceIndex    Float    // 0..N

  computedAt        DateTime @default(now())
  diarizationConfidence Float   // 0..1, из Vox; если <0.85 — метрики помечены как low_confidence
  lowConfidence     Boolean  @default(false)

  meeting           Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  participants      MeetingParticipantBehavior[]

  @@index([tenantId])
}

model MeetingParticipantBehavior {
  id                          String   @id @default(cuid())
  meetingBehaviorMetricsId    String
  participantId               String
  tenantId                    String

  displayName                 String   // снимок имени на момент расчёта (для гостей)
  isGuest                     Boolean  @default(false)

  speakingTimeMs              Int
  speakingTimePercent         Float
  turnsCount                  Int
  avgTurnDurationMs           Float
  monologueCount              Int      // turn >= 60s
  longestMonologueMs          Int
  questionCount               Int
  fillerWordsCount            Int
  interruptionsMadeCount      Int
  interruptionsReceivedCount  Int

  metrics                     MeetingBehaviorMetrics @relation(fields: [meetingBehaviorMetricsId], references: [id], onDelete: Cascade)
  participant                 Participant            @relation(fields: [participantId], references: [id])

  @@unique([meetingBehaviorMetricsId, participantId])
  @@index([tenantId])
  @@index([participantId])
}
```

Применение: `bun run prisma:push && bun run prisma:generate`.

---

## 5. BehaviorMetricsCalculator

### 5.1. Входные данные

```ts
type CalculatorInput = {
  meetingId: string;
  tenantId: string;
  totalDurationMs: number;          // из Meeting.endedAt - startedAt
  diarization: DiarizationSegment[];  // из merged.json
  participants: Array<{ id: string; identity: string; displayName: string; isGuest: boolean }>;
};

type DiarizationSegment = {
  participantIdentity: string;   // LiveKit identity (мапим в participantId на calculator-уровне)
  startMs: number;
  endMs: number;
  text: string;                  // транскрипт сегмента
  confidence: number;            // confidence ASR
};
```

### 5.2. Алгоритмы

**`speakingTimeMs`** — `SUM(segment.endMs - segment.startMs)` по participant.

**`turnsCount`** — соседние сегменты одного participant с gap < 2 сек объединяем в один turn. Считаем количество turn'ов.

**`monologueCount`, `longestMonologueMs`** — из turn'ов выбираем те, у которых duration ≥ 60_000.

**`questionCount`** — детерминистский этап: количество предложений в `segment.text`, заканчивающихся на `?`. Опционально (B.2) — LLM-refine для пограничных случаев.

**`fillerWordsCount`** — словарь stop-words по-русски: `["эээ", "ммм", "ну", "вот", "как бы", "типа", "короче", "значит", "это самое", "в общем", "в принципе", "так сказать"]`. Считаем вхождения в `segment.text` (через `/\b(...)\b/gi`). LLM-refine (B.2) — для контекстных «ну» (когда это связка vs паразит).

**`interruptionsMadeCount`** — для каждого segment'а Б проверяем: перекрывается ли он с активным segment'ом А (т.е. start_B ∈ [start_A, end_A] И длина пересечения ≥ 500ms). Если да — это «прерывание». A → `interruptionsReceived++`, B → `interruptionsMade++`.

**`silenceMs`** — `totalDurationMs - SUM(union интервалов всех speech-segments)`.

**`crossTalkMs`** — sum пересечений всех пар сегментов разных participant'ов.

**`dominanceIndex`** — `max(speakingTimeMs[i]) / median(speakingTimeMs[])`. Если median = 0 → 999 (значит почти все молчали).

### 5.3. Pure-функция

`BehaviorMetricsCalculator.calculate(input: CalculatorInput): { meeting: ..., participants: [...] }` — без side-effects, легко юнит-тестируется.

### 5.4. Edge cases

- Встреча < 60 сек → не считаем, помечаем `MeetingBehaviorMetrics.lowConfidence=true`, метрики нулевые.
- Одинокий участник (без других) → `interruptions` = 0, `crossTalkMs` = 0.
- `diarizationConfidence < 0.85` → `lowConfidence=true`, UI показывает badge «Качество диаризации низкое — метрики ориентировочные».
- Гость без `Participant` (что почти невозможно после Phase 0a/b) → fallback к `displayName = "Гость"`, `isGuest=true`, `participantId = null` (валидация решит после проверки текущей схемы).

---

## 6. Воркер `ai.behavior-metrics`

### 6.1. Файлы

```
backend/src/modules/ai/workers/behavior-metrics.worker.ts
backend/src/modules/ai/services/behavior-metrics-calculator.ts
backend/src/modules/ai/services/behavior-metrics-calculator.spec.ts
backend/src/modules/ai/services/behavior-llm-refine.ts (для B.2)
```

### 6.2. Очередь и enqueue

- Очередь `ai.behavior-metrics`, concurrency=4 (детерминистский, не дорого).
- Enqueue из `ai.merge` параллельно `ai.analyze` (см. [merge.worker.ts](../../backend/src/modules/ai/workers/merge.worker.ts)).
- Idempotency-key: `behavior:${meetingId}`.

### 6.3. Поток обработки

```ts
async process(job: Job<{ meetingId: string; tenantId: string }>) {
  const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id }, include: { transcript: true, participants: true } });
  const merged = await this.s3.fetchJson(meeting.transcript.mergedS3Url);

  const result = this.calculator.calculate({
    meetingId: meeting.id,
    tenantId: meeting.tenantId,
    totalDurationMs: meeting.endedAt!.getTime() - meeting.startedAt!.getTime(),
    diarization: merged.segments,
    participants: meeting.participants.map(p => ({ id: p.id, identity: p.identity, displayName: p.displayName, isGuest: p.isGuest })),
  });

  // B.2 — опциональный refine
  if (config.behaviorMetrics.llmRefineEnabled) {
    await this.llmRefine.refine(result, merged.segments);
  }

  await this.prisma.$transaction(async tx => {
    const main = await tx.meetingBehaviorMetrics.upsert({
      where: { meetingId: meeting.id },
      create: { ...result.meeting, meetingId: meeting.id, tenantId: meeting.tenantId },
      update: { ...result.meeting, computedAt: new Date() },
    });
    await tx.meetingParticipantBehavior.deleteMany({ where: { meetingBehaviorMetricsId: main.id } });
    await tx.meetingParticipantBehavior.createMany({
      data: result.participants.map(p => ({ ...p, meetingBehaviorMetricsId: main.id, tenantId: meeting.tenantId })),
    });
  });

  this.metrics.increment('z_behavior_metrics_computed_total');
}
```

### 6.4. Error handling

- Throw → BullMQ retry (3 attempts, backoff 30s exponential).
- После 3 retry → `Meeting.behaviorMetricsStatus = 'failed'` (новое поле, см. §4 расширение Meeting).
- Лог `error` с stack.

### 6.5. Расширение Meeting

```prisma
model Meeting {
  // ... существующие поля ...
  behaviorMetricsStatus String?  // 'pending' | 'ready' | 'failed' | 'low_confidence'
}
```

Обновляется из воркера. UI смотрит на это поле для loading-state.

---

## 7. LLM-refine (фаза B.2)

### 7.1. Зачем

`fillerWordsCount` детерминистский даёт ложноположительные («ну» как связка vs паразит). `questionCount` детерминистский по `?` пропускает риторические вопросы без знака. LLM-refine даёт +5–15% точности.

### 7.2. Промпт `behavior-refine` (через registry — sub-TZ A зависимость мягкая; до A.1 можно код-fallback)

Input: per-participant список «кандидаты на вопросы» (текст + флаг по знаку) и «кандидаты на filler» (текст + слово).

Output JSON:
```json
{
  "questions": { "<segmentIdx>": true|false },
  "fillers": { "<segmentIdx>:<wordIdx>": true|false }
}
```

Лимит: один LLM-вызов на всю встречу, через batch (не per-segment). dataClass: 'internal'.

### 7.3. Feature flag

`BEHAVIOR_METRICS_LLM_REFINE_ENABLED=true|false` через `TypedConfigService`. По умолчанию `false` — детерминистский достаточно для MVP паритета. После пилотных оценок включаем.

### 7.4. Регистрация LLM-маршрута (обязательно по [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило))

Новый `LlmTaskType='behavior-refine'`. Регистрируется через `scripts/seed-llm-task-routes-phase-B.ts` (skill `safe-seed-rules`) с **тремя уровнями** провайдеров. Источник выбора — [playbook §2.1](../../docs/reference/llm-models-playbook.md#21-дефолтная-маршрутизация-tasktype--primary--fallback-2026-05).

Категория задачи: **короткий классификатор** (батч сегментов → решение filler/question yes/no). Подходит [classifier-цепочка](../../docs/reference/llm-models-playbook.md#11-fallback-chain) из playbook.

| Tier | Provider | Model | maxDataClass | Обоснование (из playbook) |
|---|---|---|---|---|
| **primary** | `openai-via-proxy` | `gpt-5.4-nano` | internal | Дешёвый ($0.20/$1.25 за 1M), быстрый, отлично справляется с JSON-классификацией. Дефолт для коротких классификаторов в playbook §2.1. |
| **secondary** | `deepseek` | `deepseek-v4-flash` | internal | Через свою прокси, цена сравнима ($0.14/$0.28). Резерв если OpenAI proxy недоступен. |
| **tertiary** | `ollama` | `qwen3.5:9b` | private | Local fallback. Для коротких yes/no-задач классификации qwen3.5 справляется. Smoke-test обязателен в фазе A.4 DoD. |

> ⚠ **Это только seed-пресет**, не зашитая цепочка. После применения seed эти три строки попадают в `LlmTaskRoute`. Дальше super_admin меняет их через `/admin/ai-models/behavior-refine` без релиза: ставит в primary любую модель, меняет порядок, добавляет ещё provider'ов, запускает A/B. См. [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило) — таблица «жёсткое vs мягкое».

Seed-script (фрагмент с комментариями):

```ts
// scripts/seed-llm-task-routes-phase-B.ts
// Источник цепочки: docs/reference/llm-models-playbook.md §2.1 (classifier-задачи).
// behavior-refine — короткий батч-классификатор сегментов транскрипта на filler/question.
// Все 3 tier'а: maxDataClass=internal (метаданные речи участников, не контент решений).
await prisma.llmTaskRoute.createMany({
  data: [
    { taskType: 'behavior-refine', tier: 'primary',   provider: 'openai-via-proxy', model: 'gpt-5.4-nano',     priority: 0, maxDataClass: 'internal' },
    { taskType: 'behavior-refine', tier: 'secondary', provider: 'deepseek',         model: 'deepseek-v4-flash', priority: 0, maxDataClass: 'internal' },
    { taskType: 'behavior-refine', tier: 'tertiary',  provider: 'ollama',           model: 'qwen3.5:9b',        priority: 0, maxDataClass: 'private'  },
  ],
});
```

После применения seed taskType появляется в `/admin/ai-models` (страница из A.4) → super_admin может переключить primary через UI без выкатки кода.

---

## 8. API

### 8.1. Endpoint

```
GET /api/v1/meetings/:id/behavior-metrics
Auth: JwtAuthGuard + TenantGuard + ownerOrShare (хост или member Org, не гость)
Response: 200 | 404 (если воркер ещё не завершил)
```

### 8.2. DTO

```ts
class BehaviorMetricsResponseDto extends createZodDto(z.object({
  meeting: z.object({
    totalDurationMs: z.number(),
    totalSpeechMs: z.number(),
    silenceMs: z.number(),
    silencePercent: z.number(),
    crossTalkMs: z.number(),
    dominanceIndex: z.number(),
    lowConfidence: z.boolean(),
    computedAt: z.string().datetime(),
  }),
  participants: z.array(z.object({
    participantId: z.string(),
    displayName: z.string(),
    isGuest: z.boolean(),
    speakingTimeMs: z.number(),
    speakingTimePercent: z.number(),
    turnsCount: z.number(),
    avgTurnDurationMs: z.number(),
    monologueCount: z.number(),
    longestMonologueMs: z.number(),
    questionCount: z.number(),
    fillerWordsCount: z.number(),
    interruptionsMadeCount: z.number(),
    interruptionsReceivedCount: z.number(),
  })),
})) {}
```

### 8.3. Org-aggregation

```
GET /api/v1/org/behavior-metrics/aggregate?from=<ISO>&to=<ISO>&meetingType=<MeetingType?>
Auth: Org-Admin (owner, admin) + super_admin
Response: { meetings: number, avgDominanceIndex: number, avgSilencePercent: number, participants: [{ userId, totalMeetings, avgSpeakingPercent, avgQuestionsPerMeeting, avgFillerWordsPerMeeting }] }
```

Запрос идёт через materialized view или агрегацию на лету. На MVP — на лету (≤500мс на orgID, после — оптимизация).

---

## 9. Frontend

### 9.1. Страница результата встречи

Новая секция «Поведение участников» внутри страницы `/meetings/[id]/result`:

- Если `Meeting.behaviorMetricsStatus === 'pending'` — skeleton.
- Если `low_confidence` — badge «Метрики ориентировочные: качество диаризации низкое».
- Если `failed` — empty state «Метрики не удалось рассчитать. [Перезапустить]».
- Если `ready`:
  - Общие метрики: 4 карточки (всего речи, тишина, crosstalk, индекс доминирования).
  - Per-participant: горизонтальная stacked bar «время говорения», и таблица с метриками (turns, monologues, questions, filler, interruptions).
  - Графики на `Recharts` (уже есть).

### 9.2. Org-дашборд

В `/dashboard` (роль owner/admin) — новая карточка «Поведение команды»:
- Топ-3 «доминирующих» спикеров за период.
- Средний % тишины по встречам.
- Тренд (line chart) по неделям/месяцам.

### 9.3. Локализация (русский)

Добавить в `second-brain/13_glossary/copy-strings.ru.md`:
- «Время говорения» / «% времени»
- «Перевороты речи» (turns) / «Монологи» (`turn ≥ 60 сек`)
- «Самый длинный монолог»
- «Вопросы заданы»
- «Слова-паразиты»
- «Прерывания (сделано / получено)»
- «Тишина» / «Перекрёстная речь» / «Индекс доминирования»
- «Поведение участников» / «Поведение команды»
- «Метрики ориентировочные: качество диаризации низкое»

### 9.4. Доступ

- Хост встречи видит всё (включая чужие метрики).
- Участник видит только свои метрики (`/meetings/:id/behavior-metrics` фильтрует на бэке по `currentUserId`).
- Гость — НЕ видит метрики (страница результата для гостей ограничена).
- Org-Admin видит дашборд по всем встречам Org.

---

## 10. Метрики и логи

### 10.1. Prometheus

```
z_behavior_metrics_computed_total
z_behavior_metrics_low_confidence_total
z_behavior_metrics_failed_total
z_behavior_metrics_duration_seconds (histogram, время воркера)
z_behavior_metrics_llm_refine_total
z_behavior_metrics_llm_refine_cost_usd
```

### 10.2. Логи

- `info` на завершение расчёта (с meetingId, durationMs, participantsCount).
- `warn` на low_confidence.
- `error` на failure.

---

## 11. DoD

### Технические

- [ ] `bun run typecheck` чистый.
- [ ] `bun run lint` чистый.
- [ ] `bun run test:unit` зелёный: `BehaviorMetricsCalculator` покрыт ≥10 кейсами (монолог, прерывание, тишина, crosstalk, малый meeting, нулевой participant).
- [ ] `bun run test:integration` зелёный: e2e на ai.behavior-metrics воркер с фикстурой `merged.json`.
- [ ] `bun run build` чистый.

### Функциональные

- [ ] Для всех существующих meeting'ов в БД (по cron-backfill или скрипт) рассчитаны метрики.
- [ ] На реальной встрече с 4 спикерами метрики совпадают с ручной проверкой ±5%.
- [ ] Diarization confidence ≥ 0.85 → `lowConfidence=false`; меньше → `true`.
- [ ] LLM-refine (B.2) даёт измеримое улучшение (≥5% точности по filler/questions на 5 пилотных встречах) — иначе откладываем включение.
- [ ] UI: страница результата показывает секцию метрик; loading/error/low-confidence/ready состояния работают.
- [ ] Org-дашборд показывает агрегат за период; запрос ≤500мс на 100 встречах.
- [ ] Гость НЕ видит метрики (ни UI, ни API возвращает 403).

### Документация

- [ ] Создан `second-brain/01_projects/behavior-metrics.md`.
- [ ] Обновлён `second-brain/02_architecture/data-model.md` — новые модели.
- [ ] Обновлён `second-brain/01_projects/ai-jobs.md` — новый воркер.
- [ ] Обновлён `second-brain/01_projects/api-layer.md` — новые эндпоинты.
- [ ] Глоссарий расширен.
- [ ] Запись рефлексии.

### Матрица прослеживаемости (из зонтика)

- [ ] Строки 11–22 — все `[x]`.
- [ ] Строки 46, 47, 50 — `[x]` (seed-script с 3 уровнями + ссылка на playbook + smoke-test Ollama tertiary прошёл).

---

## 12. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Диаризация Vox даёт некачественный split (например, склеивает спикеров) | высокая | Полагаемся на `diarizationConfidence` из Vox-ответа. При <0.85 → `lowConfidence=true`, UI снимает с пользователя ожидание точности |
| Словарь слов-паразитов даёт ложноположительные | средняя | B.2: LLM-refine. Без него — детерминистский, но честно показываем «по словарю» в подсказке. После пилота — увеличиваем словарь |
| Метрика «прерывание» обижает участников | низкая | Не показываем гостям. Хост видит свою метрику + общие. Org-Admin видит всё. Текст в UI нейтральный («Прерывания (сделано/получено)» без оценки) |
| Backfill для существующих встреч долгий | средняя | Cron-скрипт по 10 встреч в час; флаг `Meeting.behaviorMetricsStatus = 'pending'` → не считаем дважды |
| Воркер падает на больших встречах (3+ часа) | средняя | Streaming-обработка не нужна (segments compact). Лимит memory worker'а ≤512MB. Timeout 5 минут на встречу |
| Дашборд org-aggregate тормозит на 10k встречах | средняя | Materialized view `org_behavior_aggregate_mv` — refresh раз в час. Но только если на лету >500мс. На MVP — на лету |

---

## 13. Открытые вопросы

1. **Учитывать ли AI-агентов (в будущем) как «участников»?** Пока нет — `isGuest=true` на ботов не распространяется, отфильтровываем по `Participant.kind='bot'` (если такое поле появится — см. roadmap агентов).
2. **Метрика «склонность к согласию» (yes-bias)?** Не входит, не входит в стандартные у конкурентов.
3. **Учитывать ли встречи с одним участником (моноспикер)?** Считаем, но dominanceIndex=∞ → UI показывает «—» (прочерк).

---

## 14. Итог

_TBD после реализации._

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Prisma-модели `MeetingBehaviorMetrics` (schema.prisma:5353) и `MeetingParticipantBehavior` (:5392) + расширение `Meeting.behaviorMetricsStatus`.
- `BehaviorMetricsCalculator` pure-функция + spec (`backend/src/modules/ai/services/behavior-metrics-calculator.{ts,spec.ts}`).
- LLM-refine: `backend/src/modules/ai/services/behavior-llm-refine.ts` + промпт `prompts/behavior-refine.ts`.
- Воркер `backend/src/modules/ai/workers/behavior-metrics.worker.ts` + spec.
- API-сервис: `backend/src/modules/behavior-metrics/behavior-metrics.service.ts`.
- LLM-route: `backend/scripts/seed-llm-task-routes-phase-B.ts` (3 tier: openai-via-proxy/deepseek/ollama).
- Frontend: `frontend/src/ui/components/behavior-metrics/{MeetingBehaviorSection,BehaviorTeamCard}.tsx` — секция на странице результата + org-дашборд карточка.
