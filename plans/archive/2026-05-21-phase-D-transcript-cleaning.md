---
type: tz
status: done
feature: Фаза D — Очистка транскрипта от слов-паразитов и повторов
date: 2026-05-21
parent_tz: tz/2026-05-21-competitor-parity.md
depends_on:
  - tz/2026-05-21-phase-A-prompt-registry-admin.md (мягкая — только для LLM-refine этапа; уровень 1 чисто детерминистский и не нуждается в LLM)
covers_matrix_rows: [32, 33, 34, 35, 36, 37, 38, 46, 47, 50]
---

# ТЗ D: Очистка транскрипта от слов-паразитов и повторов

> **Это sub-TZ.** Зонтичный — [`competitor-parity`](2026-05-21-competitor-parity.md).
>
> **Контекст:** у mymeet.ai есть очистка транскрипта от слов-паразитов («очищенный» режим читается как статья). У Z этого нет — транскрипт показывается «как есть», с «эээ», «ну», повторами и false starts.

---

## 1. Цель

После реализации D:
1. У каждой завершённой встречи рассчитывается **очищенный транскрипт** (`Transcript.cleanedS3Url`).
2. На UI-странице транскрипта есть toggle «Очистить от слов-паразитов» — переключает отображение между оригиналом и cleaned.
3. **Оригинал НЕ разрушается** (зонтичный Q6). Cleaning — это новый файл в S3.
4. **AI-pipeline всегда работает с оригиналом** (зонтичный Q8). Cleaning — чисто для отображения пользователю.
5. Тайм-коды сохраняются: при клике на текст в cleaned-режиме видео скроллится в правильное место.

---

## 2. Scope

### Входит в D

**Что очищаем:**
1. **Слова-паразиты** (по словарю + LLM-уточнение): «эээ», «ммм», «ну», «вот», «как бы», «типа», «короче», «значит», «это самое», «в общем», «в принципе», «так сказать», «понимаешь», «слушай», «реально» (когда не несёт смысл).
2. **Повторы**: «я-я-я думаю», «то есть то есть», «давайте давайте».
3. **False starts**: «Я хотел сказать… то есть, я думаю, что…» — оставляем только финал.
4. **Междометия без смысла**: «ага», «угу», «хм-м», когда они на собственной строке без контекста.

**Что НЕ трогаем:**
- Содержательную речь, даже если корявая.
- Стилевые особенности (диалекты, профессиональный жаргон).
- Эмоциональные акценты («ВОТ ЭТО я понимаю» → не превращаем в «это понимаю»).
- Числа, имена, цифры — никаких изменений.

**Где живёт:**
- Поле `Transcript.cleanedS3Url` (расширение существующей модели).
- Поле `Transcript.cleaningStatus`, `Transcript.cleaningStats` (что вычистили).
- Воркер `ai.transcript-clean` (отдельный, не inline в merge).
- API: `GET /meetings/:id/transcript?cleaned=true|false`.
- UI toggle на странице транскрипта.
- Org-настройка `OrgSettings.transcriptCleaningAuto: boolean` (запускать автоматически или только по запросу).

### Не входит в D

- Перевод транскрипта.
- Орфографические исправления (мы доверяем ASR Vox).
- Пунктуация (Vox уже расставляет; если нет — отдельная фаза).
- Cleaning по правилам пользователя (custom dictionary) — после паритета.
- Параллельный показ «оригинал | cleaned» бок-о-бок diff'ом — не входит, только toggle.

---

## 3. Структура и зависимости

```
D.1 Schema + воркер (1 день)
  ├── Prisma: Transcript.cleanedS3Url, cleaningStatus, cleaningStats
  ├── BullMQ worker ai.transcript-clean
  ├── Алгоритм: 2-уровневый (детерминистский словарь + LLM-уточнение)
  ├── Сохранение mapping originalOffset → cleanedOffset
  └── enqueue из ai.merge (опционально, по org-setting)
        ↓
D.2 API + UI (0.5 дня)
  ├── GET /meetings/:id/transcript?cleaned=true|false
  ├── POST /meetings/:id/transcript/clean (запустить если не было)
  ├── UI: toggle на странице транскрипта
  ├── UI: видео-скроллер использует mapping
  └── Org-setting в /admin/settings
```

**Зависит от:** ничего.
**Блокирует:** ничего.

---

## 4. Схема БД

```prisma
model Transcript {
  // ... существующие поля ...
  cleanedS3Url      String?
  cleaningStatus    String?    // 'pending' | 'ready' | 'failed' | 'not_started'
  cleaningStats     Json?      // { fillerWordsRemoved: N, repeatsRemoved: M, falseStartsRemoved: K, charsBefore: X, charsAfter: Y }
  cleanedAt         DateTime?
}

model OrgSettings {
  // ...
  transcriptCleaningAuto Boolean @default(false)
}
```

`bun run prisma:push && bun run prisma:generate`.

---

## 5. Формат cleaned-файла

S3-файл `cleaned.json`:

```json
{
  "version": 1,
  "originalUrl": "s3://.../merged.json",
  "segments": [
    {
      "originalIndex": 0,
      "participantIdentity": "user-abc",
      "startMs": 1000,
      "endMs": 8500,
      "originalText": "Эээ, ну, я думаю, что нам надо... то есть, мы должны переделать сайт.",
      "cleanedText": "Я думаю, нам надо переделать сайт.",
      "removed": [
        { "type": "filler", "text": "Эээ" },
        { "type": "filler", "text": "ну" },
        { "type": "false_start", "text": "что нам надо..." }
      ]
    }
  ],
  "stats": {
    "fillerWordsRemoved": 1234,
    "repeatsRemoved": 56,
    "falseStartsRemoved": 78,
    "charsBefore": 45678,
    "charsAfter": 38900
  }
}
```

Mapping тайм-кодов сохранён через `segments[].originalIndex`: UI знает, что cleaned-сегмент N соответствует оригинальному N → берёт `startMs` и скроллит видео туда.

---

## 6. Алгоритм очистки

### 6.1. Два уровня

**Уровень 1 — детерминистский (быстрый, дешёвый):**
- Удаление слов-паразитов из словаря (regex с word boundary, регистронезависимо).
- Удаление точных повторов (`/\b(\w+)\s+\1\b/gi` для 2 одинаковых слов подряд; до 3-х подряд).
- Удаление одиночных междометий («ага», «угу», «м-м») если segment состоит только из них.
- Длительность: < 1 сек на 100 минут аудио. Cost: $0.

**Уровень 2 — LLM-уточнение (опциональный, дорогой):**
- Контекстные «ну» (связка vs паразит).
- False starts с маркерами «то есть», «я хотел сказать», «короче».
- Длительные повторы 3+ слов.
- Чанками по 5–10 segment'ов за вызов (batch).
- dataClass: 'internal'.
- Cost: ~$0.05 на 100-минутную встречу.

### 6.2. Feature flag

`TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED=true|false` (`TypedConfigService`). По умолчанию `true` — стоит дешёво, заметно улучшает качество.

### 6.3. Промпт `transcript-clean-refine`

Через PromptRegistry (sub-TZ A) с code-fallback.

### 6.4. Регистрация LLM-маршрута (обязательно по [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило))

Новый `LlmTaskType='transcript-clean-refine'` (только для уровня 2, опциональный). Регистрируется через `scripts/seed-llm-task-routes-phase-D.ts`.

Категория задачи: **короткий батч-классификатор** (фрагменты сегментов → подтверждение filler/false-start). По [playbook §11](../../docs/reference/llm-models-playbook.md#11-fallback-chain) — `classifier`-цепочка.

| Tier | Provider | Model | maxDataClass | Обоснование |
|---|---|---|---|---|
| **primary** | `openai-via-proxy` | `gpt-5.4-nano` | internal | Дёшево, быстро, JSON-стабильно. Дефолт для классификаторов. |
| **secondary** | `deepseek` | `deepseek-v4-flash` | internal | Резерв при отказе OpenAI proxy. |
| **tertiary** | `ollama` | `qwen3.5:9b` | private | Для filler/false-start qwen3.5 справляется. Если на smoke-тесте окажется, что точность < 70% — в tertiary включаем фоллбек: «отключить LLM-refine, оставить только уровень 1 (детерминистский)». Воркер должен корректно отработать без LLM. |

> ⚠ **Это только seed-пресет**, не зашитая цепочка. После применения seed эти три строки попадают в `LlmTaskRoute`. Дальше super_admin меняет их через `/admin/ai-models/transcript-clean-refine` без релиза: ставит в primary любую модель, меняет порядок, добавляет provider'ов, запускает A/B. Особенность D: если super_admin вообще отключит LLM-refine (`BEHAVIOR_METRICS_LLM_REFINE_ENABLED=false`), весь LLM-маршрут игнорируется — воркер работает только через уровень 1. См. [зонтик Q9](2026-05-21-competitor-parity.md#q9-llm-провайдеры-—-трёхуровневая-цепочка--админка-моделей-обязательное-правило).

Seed-script:
```ts
// scripts/seed-llm-task-routes-phase-D.ts
// Источник: docs/reference/llm-models-playbook.md §2.1 (classifier chain).
// transcript-clean-refine — опциональный LLM-уточнитель уровня 2 (детерминистский уровень 1 работает без LLM).
// Tertiary: если qwen не справится — воркер откатывается на «только уровень 1» без падения.
await prisma.llmTaskRoute.createMany({
  data: [
    { taskType: 'transcript-clean-refine', tier: 'primary',   provider: 'openai-via-proxy', model: 'gpt-5.4-nano',     priority: 0, maxDataClass: 'internal' },
    { taskType: 'transcript-clean-refine', tier: 'secondary', provider: 'deepseek',         model: 'deepseek-v4-flash', priority: 0, maxDataClass: 'internal' },
    { taskType: 'transcript-clean-refine', tier: 'tertiary',  provider: 'ollama',           model: 'qwen3.5:9b',        priority: 0, maxDataClass: 'private'  },
  ],
});
```

**Важно:** уровень 1 (`DeterministicCleaner`) работает БЕЗ LLM. Если все три tier'а недоступны — воркер успешно завершает работу с `cleaningStatus='ready'`, в `cleaningStats.llmRefineSkipped=true`. Это отличает D от B/C/E — там LLM критичен.

```
Ты — редактор-корректор. Получаешь segment'ы транскрипта встречи. Для каждого верни «очищенный» текст без слов-паразитов, повторов и false starts.

ПРАВИЛА:
1. НЕ меняй содержательную речь, даже если она корявая.
2. НЕ исправляй орфографию / пунктуацию — ASR уже это сделал.
3. Сохраняй стиль и эмоции говорящего.
4. Удаляй ТОЛЬКО:
   - Слова-паразиты, которые не несут смысла («ну», «вот», «эээ»).
   - Дословные повторы («то есть то есть»).
   - False starts («Я хотел сказать… то есть, я думаю» → оставь только «Я думаю»).

ВЕРНИ JSON массив:
[
  {
    "originalIndex": <int>,
    "cleanedText": "<строка>",
    "removed": [{ "type": "filler|repeat|false_start", "text": "<что удалили>" }]
  }
]

Сегменты:
{{segments}}
```

Output Schema жёстко через Zod.

---

## 7. Воркер `ai.transcript-clean`

### 7.1. Файл

`backend/src/modules/ai/workers/transcript-clean.worker.ts`.

### 7.2. Очередь

`ai.transcript-clean`, concurrency=2.

### 7.3. Enqueue

- Автоматически после `ai.merge` ЕСЛИ `org.settings.transcriptCleaningAuto === true`.
- По запросу через `POST /meetings/:id/transcript/clean` (для хоста или Org-Admin).

### 7.4. Обработка

```ts
async process(job) {
  const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id }, include: { transcript: true } });
  if (meeting.transcript.cleaningStatus === 'ready') return; // idempotent
  
  await this.markPending(meeting.transcript.id);
  
  const merged = await this.s3.fetchJson(meeting.transcript.mergedS3Url);
  
  // Уровень 1
  const phase1 = this.deterministicClean.clean(merged.segments);
  
  // Уровень 2 (опциональный)
  let phase2 = phase1;
  if (config.transcriptCleaning.llmRefineEnabled) {
    phase2 = await this.llmRefine.refine(phase1);
  }
  
  // Сборка cleaned.json
  const cleanedJson = { version: 1, originalUrl: meeting.transcript.mergedS3Url, segments: phase2, stats: this.calcStats(phase1, phase2) };
  const s3Key = `meetings/${meeting.id}/transcripts/cleaned.json`;
  const cleanedUrl = await this.s3.uploadJson(s3Key, cleanedJson);
  
  await this.prisma.transcript.update({
    where: { id: meeting.transcript.id },
    data: { cleanedS3Url: cleanedUrl, cleaningStatus: 'ready', cleaningStats: cleanedJson.stats, cleanedAt: new Date() },
  });
  
  this.metrics.increment('z_transcript_cleaning_completed_total');
}
```

### 7.5. Error handling

- Throw → retry 3x с backoff.
- После 3 fail → `cleaningStatus='failed'`, метрика `z_transcript_cleaning_failed_total`.

---

## 8. API

### 8.1. Endpoint выдачи

```
GET /api/v1/meetings/:id/transcript?cleaned=true|false
  Auth: хост или член Org (или гость с MeetingShare.allowTranscript)
  Response 200: presigned URL на S3-файл (как сейчас, но другой ключ)
  Если cleaned=true и cleaningStatus !== 'ready' → 404 с body { reason: 'pending'|'not_started'|'failed' }
```

### 8.2. Запуск cleaning

```
POST /api/v1/meetings/:id/transcript/clean
  Auth: хост (Meeting.ownerId) или Org-Admin
  Rate-limit: 1 в час на meeting (cleaning редкий)
  Response 202: { jobId, status: 'queued' }
  Если cleaningStatus === 'ready' → 200 { status: 'already_clean' }
  Если cleaningStatus === 'pending' → 409 { status: 'in_progress' }
```

### 8.3. Org-setting

```
PATCH /api/v1/org/settings/transcript-cleaning
  Auth: owner / admin
  Body: { auto: boolean }
  Response 200
```

---

## 9. Frontend

### 9.1. Toggle на странице транскрипта

В `/meetings/[id]/result`, секция «Транскрипт»:
- Toggle «🧹 Очистить от слов-паразитов» сверху.
- Default: off (показываем оригинал).
- Если `cleaningStatus !== 'ready'`:
  - Toggle disabled с подсказкой «Очищенный транскрипт ещё не готов».
  - Если `cleaningStatus === 'not_started'` или null → кнопка «Очистить» (вызывает `POST .../clean`).
- При включении toggle:
  - Запрос `GET .../transcript?cleaned=true`.
  - Замена контента на cleaned-сегменты.
  - Видео-скроллер использует `originalIndex → originalStartMs` из mapping.

### 9.2. Indicator

Над транскриптом — badge со статистикой (только если cleaned активен):
- «Удалено: 1 234 слов-паразита, 56 повторов, 78 false starts»
- Сокращение по знакам: -15% (38 900 / 45 678).

### 9.3. Настройки Org

В `/admin/settings/meetings`:
- Чекбокс «Автоматически очищать транскрипт после встречи».
- Подсказка: «Очистка занимает ~30 секунд после готовности транскрипта. Стоимость ~$0.05 за 100 минут аудио».

### 9.4. Локализация

Добавить в `delivery/ui/copy-strings.ru.md`:
- «Очистить от слов-паразитов»
- «Очищенный транскрипт» / «Оригинал»
- «Удалено слов-паразитов» / «Повторов» / «Незавершённых фраз»
- «Очистка занимает около 30 секунд после готовности транскрипта»
- «Автоматически очищать транскрипт после встречи»

---

## 10. Метрики и логи

### 10.1. Prometheus

```
z_transcript_cleaning_completed_total
z_transcript_cleaning_failed_total
z_transcript_cleaning_duration_seconds (histogram)
z_transcript_cleaning_chars_reduced (histogram)   # сколько % символов удалили
z_transcript_cleaning_llm_cost_usd                # counter
```

### 10.2. Логи

- `info` на successful clean (с meetingId, statsна % сокращения).
- `warn` на failed.

---

## 11. DoD

### Технические

- [ ] `bun run typecheck && lint && build` чистые.
- [ ] Unit-тесты на DeterministicCleaner:
  - [ ] Удаление слов-паразитов из словаря.
  - [ ] Сохранение «ну» когда это связка (контекст не учитывается на этом уровне — оставляем кандидатами для LLM-уточнения).
  - [ ] Удаление повторов 2-3 слов.
  - [ ] Удаление одиночных междометий.
- [ ] Integration-тест на воркер: фикстура merged.json → cleaned.json создаётся, mapping корректен.
- [ ] `bun run prisma:push` без warnings.

### Функциональные

- [ ] На 3-х пилотных встречах cleaning отрабатывает за <60 сек, сокращение 10-20% символов.
- [ ] Содержательная речь не пострадала (manual review).
- [ ] UI toggle переключает корректно; видео-скроллер работает в обоих режимах.
- [ ] Запуск через `POST .../clean` для встречи с `cleaningStatus=null` создаёт cleaned-файл.
- [ ] Org-setting `auto=true` → новые встречи автоматически получают cleaned.
- [ ] AI-pipeline (`ai.analyze`, `ai.chapters`, `ai.tasks`) НЕ использует cleaned — проверено через лог `s3.fetchJson` (всегда `merged.json`).

### Документация

- [ ] `second-brain/01_projects/transcript-cleaning.md`.
- [ ] `data-model.md`, `module-map.md`, `ai-jobs.md` обновлены.
- [ ] Глоссарий расширен.
- [ ] Рефлексия.

### Матрица прослеживаемости

- [ ] Строки 32–38 — все `[x]`.
- [ ] Строки 46, 47, 50 — `[x]` (seed-script с 3 уровнями + ссылка на playbook + smoke-test tertiary; при полном отказе LLM воркер завершает работу через уровень 1).

---

## 12. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Cleaning ломает содержательную речь | критичная | Manual review 3-х пилотных встреч ДО релиза. Промпт LLM явно запрещает менять содержание. Уровень 1 — только словарь, не текст |
| Тайм-коды ломаются → видео-скроллер не работает | критичная | Mapping `originalIndex` сохраняется в cleaned.json. UI-тест: clicked на cleaned-сегмент → video.currentTime соответствует original startMs ±100мс |
| Авто-cleaning увеличивает cost для всех Org | средняя | Org-setting `transcriptCleaningAuto` по умолчанию `false`. Включают сами, оценив бюджет |
| Cleaning медленный на 3+ часовых встречах | средняя | Уровень 1 быстрый (< 1 сек), уровень 2 батчится. Лимит на встречу — 5 минут timeout |
| Пользователи ожидают, что cleaned = «отредактированный текст», и не понимают, что это машинная очистка | низкая | Подсказка в UI «Очистка автоматическая, может пропустить или удалить лишнее. Оригинал доступен в любой момент» |
| Cleaning меняет смысл вопроса (например, «ну? и что?» → «и что?») | средняя | Уровень 2 LLM-промпт явно учит сохранять «ну?» как риторический вопрос. Тест-кейсы для регресса |

---

## 13. Открытые вопросы

1. **Применять cleaning к chat-messages (in-meeting chat)?** Нет, чат это пользовательский текст, не ASR-генерация.
2. **Custom dictionary для Org?** Не входит, после паритета.
3. **Diff-view «оригинал vs cleaned»?** Не входит, только toggle.

---

## 14. Итог

_TBD после реализации._

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Расширение Prisma `Transcript.cleanedS3Url/cleaningStatus/cleaningStats/cleanedAt` + `OrgSettings.transcriptCleaningAuto`.
- Сервисы: `backend/src/modules/ai/services/transcript-cleaning.service.ts` (детерминистский уровень 1) + `transcript-clean-llm-refine.service.ts` (уровень 2).
- Воркер: `backend/src/modules/ai/workers/transcript-clean.worker.ts` + `.spec.ts` + `.regression.spec.ts`.
- Промпт `prompts/transcript-clean-refine.ts`.
- LLM-route: `backend/scripts/seed-llm-task-routes-phase-D.ts` (3 tier: gpt-5.4-nano/deepseek-flash/ollama).
- Frontend toggle для cleaned-режима — есть в meeting-result-v2 (через `MeetingResultPageReal`).
