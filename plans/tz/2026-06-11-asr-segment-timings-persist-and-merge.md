---
type: tz
status: ready-to-implement
feature: asr-segment-timings-persist-and-merge
date: 2026-06-11
owner: sergrv80 (владелец Z/Кора)
relates_to:
  - plans/analysis/2026-06-11-asr-speech-timing-best-solution-proven.md
  - plans/analysis/2026-06-10-diarization-timing-rootcause.md
  - plans/tz/2026-06-10-bugfix-fleet-retest3.md
supersedes: plans/tz/2026-06-07-asr-word-timestamps-duration-behavior.md
---
> Анализ (доказательная база): [`plans/analysis/2026-06-11-asr-speech-timing-best-solution-proven.md`](../analysis/2026-06-11-asr-speech-timing-best-solution-proven.md) · Статус согласования: 2026-06-11 (владелец одобрил направление Tier 0).

# ТЗ — Посегментные тайминги речи: персист + переплётка по ролям и времени (Tier 0)

## Цель
Транскрипт встречи должен быть **переплетён по ролям и времени** («Сергей (0:10) → Александр (0:25) → Сергей (0:40)»), а «Поведение участников» и длительность — **точными**. Сейчас лента схлопывается в «N реплик = N дорожек» (по одному монологу на дорожку), а метрики абсурдны («всего речи 130 мин при 44-минутной встрече»).

## Зачем (болезненное состояние → почему решение лучше)
- **Боль:** на КАЖДОЙ встрече транскрипт не диалог, а «вся речь спикера А целиком, затем вся речь Б»; блок поведения показывает «перекрёстная речь 128 мин / тишина 0% / доли в сумме ≫100%» с плашкой «качество диаризации низкое». Подрывает доверие к продукту (rootcause-док §1).
- **Доказанный корень (эмпирически, анализ §3):** прод-модель Vox `v3_e2e_rnnt` **уже** возвращает посегментные тайм-коды в `extendedResult.segments` `{start,end,text}` (секунды) — на ровно том запросе, что шлёт живой per-track конвейер (`diarizationEnabled:false`). Парсер `parseVoxResult` их **уже** извлекает в `voxResult.segments`. Но `transcribe.worker` персистит только `words`, в `TranscriptTrack` нет колонки `segments`, а `merge.worker` читает только `words` → фолбэк «1 псевдо-слово на всю дорожку» → накладка дорожек.
- **Почему это лучшее решение:** алгоритм слияния `mergeWordTimestamps` корректен, а `behavior-metrics-calculator` построен под посегментный вход — им просто нечего скормить. Фикс **backend-only, без изменения Vox/submit, без новых ENV/зависимостей/Python**. Сегментный уровень — ровно то, что рендерят Otter/Fireflies/Gong/Zoom (реплика-блок, не слова) — анализ §4.

## REALITY-CHECK (фактическое состояние по коду на 2026-06-11)
| Компонент | Факт | Вывод |
|---|---|---|
| `vox.service.ts` `parseVoxResult` ([:444](../../backend/src/modules/ai/services/vox.service.ts#L444)) | **Уже** маппит `extendedResult.segments` → `result.segments` (`mapDiarizedSegments`). Возвращает `VoxResult.segments` ([vox.types.ts:96](../../backend/src/modules/ai/services/vox.types.ts#L96)) | ✅ Готово — **не трогать парсер** |
| `merger.ts` `mergeWordTimestamps` ([:58](../../backend/src/modules/ai/services/merger.ts#L58)) | Корректен: offset входа → абсолютное время → сортировка → нарезка по смене спикера / паузе >1.5с | ✅ Готово — **не трогать алгоритм** |
| `behavior-metrics-calculator.ts` | Считает union/crosstalk/доли по сегментам; построен под per-segment вход (коммент [:308](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts#L308)) | ✅ Готово — **не трогать калькулятор** |
| `TranscriptTrack` ([schema.prisma:1526](../../backend/prisma/schema.prisma#L1526)) | Есть `words Json`, **нет `segments`** | 🔴 Фаза 1 |
| `transcribe.worker.ts` `trackData` ([:581](../../backend/src/modules/ai/workers/transcribe.worker.ts#L581)) | Персистит `words`, **не персистит `voxResult.segments`** | 🔴 Фаза 2 |
| `merge.worker.ts` perTrack-builder ([:137](../../backend/src/modules/ai/workers/merge.worker.ts#L137)) | Фолбэк = 1 псевдо-слово на ВСЮ дорожку | 🔴 Фаза 3 |
| `behavior-metrics.worker.ts` флаг ([:153](../../backend/src/modules/ai/workers/behavior-metrics.worker.ts#L153)) | `wordTimingsAvailable` меряет только `track.words` → ложный `lowConfidence` при сегментах | 🔴 Фаза 4 |
| `vox.no_words` диагностика ([:243](../../backend/src/modules/ai/services/vox.service.ts#L243)) | Проверяет `ro.segments`/`nestedRo.segments`, не `extendedResult.segments` → слепое пятно | 🟡 Фаза 5 (полировка) |
| Фронт `Transcript.turns` (`MeetingResultPageReal`/`structured-report`) | Уже рендерит ленту реплик из `turns` | ✅ Правок не требует |

**Scope пересчитан под фактический остаток:** фича на ~70% уже в коде (парсер, слияние, калькулятор, фронт готовы). Реальный остаток — только «сохранить и прочитать сегменты» + честный флаг. Это backend-only, ~4 точечные правки + 1 миграция.

## Принятые решения (владелец одобрил направление; не пересматривать)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | Источник таймингов — **`extendedResult.segments` как есть**, без `diarizationEnabled:true` и без смены модели | Эмпирически сегменты приходят при `diar:false` (анализ §3.2 plain). Включать диаризацию = лишняя латентность + `speakerMode:fixed_2` разобьёт одного спикера на дорожке надвое. Не оптимизировать «давайте включим диаризацию» |
| Б2 | Хранить slim-форму `Array<{startSec:number; endSec:number; text:string}>` — **без** `speaker`/`speaker_id` | Спикер дорожки известен по `TranscriptTrack.speakerName`; `speaker_id` от одно-спикерной дорожки бессмыслен |
| Б3 | `merge.worker`: при пустых `words`, но непустых `segments` — **1 псевдо-слово НА СЕГМЕНТ** (не на дорожку) | Даёт переплётку по предложениям; `mergeWordTimestamps` склеит сегменты одного спикера с gap<1.5с в один turn |
| Б4 | Приоритет источников в `merge.worker`: `words` → `segments` → `transcriptText` (старый фолбэк) → пусто | `words` сверху — готовность к Tier 1 (когда Vox начнёт слать слова, наш парсер их уже примет — анализ §5). Старый фолбэк остаётся последним резервом |
| Б5 | `behavior-metrics`: `timingsAvailable = any track has words OR segments`; имя параметра калькулятора `wordTimingsAvailable` **оставить** | Сегментный тайминг точен для речевых метрик (union/crosstalk/доли) → `lowConfidence` ставить НЕ нужно. Имя не меняем, чтобы не трогать публичный интерфейс калькулятора и его spec'и; меняем только вычисление флага + JSDoc |
| Б6 | Колонка `segments Json?` **nullable**, без backfill старых встреч | Старые `TranscriptTrack` сырой ответ Vox не хранили — сегменты для них невосстановимы без перетранскрибации (отдельная стоимость). Новые встречи получают фикс. Backfill — out of scope (см. ниже) |
| Б7 | Миграция через **версионируемый `prisma:migrate`** (CLAUDE.md 2026-06-05), НЕ `db push` | CLAUDE.md: «ЛЮБОЕ изменение в БД = файл миграции». *(Текст скилла tz-author про «только prisma:push» — устарел; приоритет у CLAUDE.md/кода.)* |

## Доказательство выбора (сжатие, полная версия — в анализе §3, §5)
Состязательно (анализ §5): альтернативы отвергнуты —
| Альтернатива | На чём ломается |
|---|---|
| (б) submit-флаг `word_timestamps` | В OpenAPI Vox такого параметра **нет** (анализ §3.1) |
| `diarizationEnabled:true` на per-track | Лишняя латентность + риск ложного сплита одного спикера; сегменты и так есть при `diar:false` |
| Смена модели на CTC | CTC тоже не отдаёт `words` на этом endpoint; сегменты те же — выгоды ноль |
| forced-alignment (Echogarden/sherpa-onnx) | Избыточно для сегментного уровня; GPL/веса/инфра-сложность. Резерв только для Tier 2 (word-level) |
Выбранное (Tier 0) доминирует по всем критериям: стоимость (только наш код), риск (переиспользует готовые парсер/слияние/калькулятор), отсутствие внешних зависимостей.

## Scope
**Входит:**
1. Колонка `TranscriptTrack.segments Json?` + версионируемая миграция.
2. Персист `voxResult.segments` в `transcribe.worker`.
3. Развилка источника в `merge.worker` (псевдо-слово на сегмент).
4. Честный `timingsAvailable` в `behavior-metrics.worker` (words ИЛИ segments).
5. Полировка: устранить слепое пятно лога `vox.no_words`; обновить second-brain.

**Не входит (с судьбой):**
- **Backfill старых встреч** (перетранскрибация ради сегментов) → vNext-ТЗ `asr-segment-timings-backfill` при запросе владельца (продуктовое решение о стоимости). По умолчанию — НЕ делаем (Б6).
- **Word-level тайминги (Tier 1):** запрос к agent-lia отдать пословные тайминги — это изменение Vox-сервера, не наш код; наш парсер уже готов их принять. Отдельный трек (анализ §5 Tier 1).
- **Tier 2** (sherpa-onnx/forced-alignment) — контингентный план, не входит.
- **UI-полировка транскрипта** (аватары/цвета спикеров, клик-перемотка, полоса говорения, «караоке») → отдельное UI-ТЗ; согласуется с `project_dashboards_redesign_approved` и UX-разбором (анализ §4). Базовая переплётка по ролям работает без UI-правок.

## Граничные контракты
- **Vox / `parseVoxResult` / `VoxResult.segments`** — реализованы, в этом ТЗ **не меняются**. Считаем `voxResult.segments?: Array<{startSec,endSec,speaker,speakerId,text}>` готовым входом ([vox.types.ts:66](../../backend/src/modules/ai/services/vox.types.ts#L66)).
- **`mergeWordTimestamps` / `behavior-metrics-calculator`** — публичные сигнатуры не меняем (кроме семантики флага по Б5).

## Контракты-first (дословные сниппеты для копипасты)

> ⚠️ Номера строк — на момент написания. Перед правкой перечитать файл и найти якорь по приведённому уникальному символу.

### Prisma — `TranscriptTrack` (якорь: `words           Json`, [schema.prisma:1537-1538](../../backend/prisma/schema.prisma#L1537))
Добавить колонку сразу после `words`:
```prisma
  /// Array<{ word: string; startMs: number; endMs: number }>
  words           Json
  /// Посегментные тайминги речи дорожки из Vox extendedResult.segments.
  /// Array<{ startSec: number; endSec: number; text: string }> (секунды, float).
  /// NULL для дорожек, расшифрованных до появления колонки (backfill не делаем).
  segments        Json?
```
Команда: `bun run prisma:migrate -- --name transcript_track_segments` → ревью SQL (только `ADD COLUMN "segments" JSONB`) → `bun run prisma:generate`.

### Персист — `transcribe.worker.ts` `trackData` (якорь: `words: (voxResult.words ?? [])`, [:588](../../backend/src/modules/ai/workers/transcribe.worker.ts#L588))
```ts
    const trackData = {
      speakerName: track.participantName,
      participantId: track.participantId ?? null,
      trackStartedAt: track.startedAt,
      baseStartedAt,
      transcriptText: voxResult.transcriptText,
      durationSeconds: voxResult.durationSeconds,
      words: (voxResult.words ?? []) as unknown as Prisma.InputJsonValue,
      // Посегментные тайминги (slim-форма Б2): спикер известен по дорожке.
      segments: (voxResult.segments ?? []).map((s) => ({
        startSec: s.startSec,
        endSec: s.endSec,
        text: s.text,
      })) as unknown as Prisma.InputJsonValue,
    };
```

### Потребление — `merge.worker.ts` perTrack-builder (якорь: `const rawWords = (track.words ?? [])`, [:138](../../backend/src/modules/ai/workers/merge.worker.ts#L138))
Заменить вычисление `effectiveWords` (Б3/Б4):
```ts
    const perTrack: PerTrackWords[] = meeting.transcript.tracks.map((track) => {
      const rawWords = (track.words ?? []) as Array<{ word: string; startMs: number; endMs: number }>;
      const rawSegments = (track.segments ?? []) as Array<{ startSec: number; endSec: number; text: string }>;
      // Приоритет: пословные тайминги → посегментные → весь текст (последний резерв).
      let effectiveWords: Array<{ word: string; startMs: number; endMs: number }>;
      if (rawWords.length > 0) {
        effectiveWords = rawWords;
      } else if (rawSegments.length > 0) {
        // 1 псевдо-слово на КАЖДЫЙ сегмент → переплётка по предложениям/времени.
        effectiveWords = rawSegments
          .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0 && s.endSec > s.startSec)
          .map((s) => ({
            word: s.text,
            startMs: Math.round(s.startSec * 1000),
            endMs: Math.round(s.endSec * 1000),
          }));
      } else if (track.transcriptText.trim().length > 0) {
        // Резерв: ни words, ни segments — 1 псевдо-слово на всю дорожку (как было).
        effectiveWords = [
          {
            word: track.transcriptText,
            startMs: 0,
            endMs: Math.max(0, Math.round((track.durationSeconds ?? 0) * 1000)),
          },
        ];
      } else {
        effectiveWords = [];
      }
      return {
        speakerName: track.speakerName,
        words: effectiveWords,
        trackStartedAt: track.trackStartedAt,
        baseStartedAt: track.baseStartedAt,
        participantId: track.participantId,
        livekitIdentity: track.livekitIdentity,
      };
    });
```

### Честный флаг — `behavior-metrics.worker.ts`
1. select (якорь: `tracks: { select: { words: true } }`, [:104](../../backend/src/modules/ai/workers/behavior-metrics.worker.ts#L104)) → `tracks: { select: { words: true, segments: true } }`.
2. флаг (якорь: `const wordTimingsAvailable =`, [:153](../../backend/src/modules/ai/workers/behavior-metrics.worker.ts#L153)):
```ts
    // Тайминги доступны, если у дорожки есть пословные ИЛИ посегментные тайм-коды
    // (оба точны для речевых метрик). Иначе поведение посчитано по длительности
    // дорожек (приблизительно) → lowConfidence.
    const wordTimingsAvailable = (meeting.transcript?.tracks ?? []).some(
      (t) =>
        (Array.isArray(t.words) && (t.words as unknown[]).length > 0) ||
        (Array.isArray(t.segments) && (t.segments as unknown[]).length > 0),
    );
```

### Полировка диагностики — `vox.service.ts` `vox.no_words` (якорь: `const segs = ro.segments ?? nestedRo.segments;`, [:244](../../backend/src/modules/ai/services/vox.service.ts#L244))
Расширить, чтобы видеть и `extendedResult.segments` (иначе лог врёт `hasSegments:false`):
```ts
          const extForSegs = (ro.extendedResult ?? {}) as Record<string, unknown>;
          const segs = ro.segments ?? nestedRo.segments ?? (extForSegs as Record<string, unknown>).segments;
```

## Поток (ASCII)
```
Vox extendedResult.segments[{start,end,text}]  (есть СЕЙЧАС, diar:false)
        │ parseVoxResult (готово)
        ▼
voxResult.segments ──[Фаза2 персист]──▶ TranscriptTrack.segments (Json?)  [Фаза1 колонка]
        │
        ▼ merge.worker [Фаза3]: words? → segments(1 псевдо-слово/сегмент)? → transcriptText?
        ▼
mergeWordTimestamps (готово) ─▶ Transcript.turns (переплётка по ролям/времени) ─▶ фронт (готово)
        │
        ▼ behavior-metrics [Фаза4]: timingsAvailable = words∪segments → метрики точны, lowConfidence=false
```

## Требования (EARS, трассируемые)
- **R1.** Если `voxResult.segments` непустой, then `transcribe.worker` shall сохранить их в `TranscriptTrack.segments` в форме `Array<{startSec,endSec,text}>`.
- **R2.** `TranscriptTrack` shall иметь nullable JSON-колонку `segments`.
- **R3.** Когда `merge.worker` строит `perTrack` и у дорожки `words.length===0` и `segments.length>0`, система shall создать по одному псевдо-слову на каждый валидный сегмент с `startMs=round(startSec*1000)`, `endMs=round(endSec*1000)`, `word=segment.text`.
- **R4.** Если у дорожки нет ни `words`, ни `segments`, но есть `transcriptText`, then система shall использовать прежний фолбэк «1 псевдо-слово на дорожку».
- **R5.** Сегмент с `endSec<=startSec` или пустым `text` shall быть исключён из псевдо-слов.
- **R6.** `behavior-metrics.worker` shall вычислять `wordTimingsAvailable` как «хотя бы у одной дорожки есть words ИЛИ segments»; при наличии сегментов `lowConfidence` из-за отсутствия пословных таймингов shall НЕ выставляться.
- **R7.** `mergeWordTimestamps` и `behavior-metrics-calculator` shall остаться без изменений алгоритма (только вход).
- **R8.** Миграция shall быть применима через `prisma migrate deploy` (идемпотентный `ADD COLUMN`).

## Фазы (dependency-ordered, строго последовательно)

```
Фаза1 (schema+миграция) ──▶ Фаза2 (персист) ──▶ Фаза3 (merge) ──▶ Фаза4 (behavior) ──▶ Фаза5 (полировка+доки)
```
Фазы 2/3/4 зависят от Фазы 1 (колонка должна существовать в Prisma Client). Внутри — последовательно: Фаза 3 проверяется e2e на данных из Фазы 2; Фаза 4 читает колонку из Фазы 1.

### [x] Фаза 1 — Схема + миграция
**Файлы:** `backend/prisma/schema.prisma` (TranscriptTrack), `backend/prisma/migrations/*`.
**Что входит:** колонка `segments Json?` (сниппет выше) + `prisma:migrate -- --name transcript_track_segments` + `prisma:generate`.
**Что НЕ входит:** backfill, изменение `words`, HNSW/GIN.
**Acceptance:**
- `grep -n "segments        Json?" backend/prisma/schema.prisma` → найдено.
- Новый файл в `backend/prisma/migrations/*_transcript_track_segments/migration.sql`, содержащий `ADD COLUMN` для `segments` (JSONB), **без** `DROP`/destructive.
- `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный.
**Закрывает:** R2, R8.

### [x] Фаза 2 — Персист сегментов
**Файлы:** `backend/src/modules/ai/workers/transcribe.worker.ts` (`trackData`, :581).
**Что входит:** добавить поле `segments` в `trackData` (сниппет). Применяется в обоих путях upsert (`create`/`update`) автоматически (общий `trackData`).
**Что НЕ входит:** правки парсера/submit/poll.
**Acceptance:**
- `grep -n "voxResult.segments ?? \[\]" backend/src/modules/ai/workers/transcribe.worker.ts` → найдено.
- Юнит/мок: при `voxResult.segments=[{startSec:1,endSec:2,text:'а'}]` upsert получает `segments` длиной 1 со slim-полями (без `speaker`/`speakerId`).
- `bunx vitest run backend/src/modules/ai/workers/transcribe.worker.spec.ts` зелёный; typecheck зелёный.
**Закрывает:** R1.

### [x] Фаза 3 — Потребление в merge (переплётка)
**Файлы:** `backend/src/modules/ai/workers/merge.worker.ts` (perTrack-builder, :137); тесты `backend/src/modules/ai/workers/merge.worker.spec.ts` (+ при наличии `merger.spec.ts`).
**Что входит:** развилка источников (сниппет Б3/Б4), фильтр вырожденных сегментов (R5).
**Что НЕ входит:** изменение `mergeWordTimestamps` (merger.ts) — только вход.
**Acceptance (вход→выход):**
- Вход: 2 дорожки, у каждой `words=[]`, но `segments` = [{0,5,"A1"},{10,15,"A2"}] (трек A) и [{6,9,"B1"}] (трек B), `trackStartedAt==baseStartedAt`.
  Выход `mergeWordTimestamps`: ≥3 turn'а, порядок по времени `A("A1") → B("B1") → A("A2")` (B@6 раньше A2@10), `totalDurationSeconds≈15` (не сумма дорожек).
- Негатив: сегмент `{endSec:1,startSec:1,text:'x'}` и `{startSec:0,endSec:1,text:'  '}` исключены.
- Резерв: `words=[]`, `segments=[]`, `transcriptText='привет'` → 1 turn на дорожку (старое поведение сохранено).
- `grep -n "rawSegments" backend/src/modules/ai/workers/merge.worker.ts` → найдено.
- `bunx vitest run backend/src/modules/ai/workers/merge.worker.spec.ts` зелёный; typecheck/lint/build зелёные.
**Закрывает:** R3, R4, R5, R7.

### [x] Фаза 4 — Честный флаг behavior-metrics
**Файлы:** `backend/src/modules/ai/workers/behavior-metrics.worker.ts` (select :104, флаг :153); тест `behavior-metrics.worker.spec.ts`.
**Что входит:** `segments: true` в select; `wordTimingsAvailable = words∪segments` (сниппет Б5); обновить JSDoc-комментарий поля в калькуляторе ([behavior-metrics-calculator.ts:55-62](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts#L55)) — «пословные ИЛИ посегментные».
**Что НЕ входит:** изменение формул калькулятора; изменение имени параметра `wordTimingsAvailable` (Б5).
**Acceptance:**
- При дорожках с `segments.length>0` и `words=[]` → `wordTimingsAvailable===true` → `meeting.lowConfidence===false` (при нормальной длительности/confidence).
- При `words=[] && segments=[]` (только transcriptText) → `wordTimingsAvailable===false` → `lowConfidence===true` (поведение сохранено).
- `grep -n "segments: true" backend/src/modules/ai/workers/behavior-metrics.worker.ts` → найдено.
- `bunx vitest run backend/src/modules/ai/workers/behavior-metrics.worker.spec.ts` зелёный; typecheck зелёный.
**Закрывает:** R6.

### [x] Фаза 5 — Полировка + second-brain
**Файлы:** `backend/src/modules/ai/services/vox.service.ts` (vox.no_words, :244); `second-brain/02_architecture/code-pitfalls.md`; `second-brain/02_architecture/data-model.md`; `second-brain/04_не-сделано/README.md`; `docs/operations/prod-deploy-log.md` (Шаг 4).
**Что входит:**
- Диагностика `vox.no_words` видит `extendedResult.segments` (сниппет).
- `code-pitfalls.md:503` — обновить: «v3_e2e_rnnt отдаёт СЕГМЕНТНЫЕ тайминги в `extendedResult.segments` (не word-level); потеря была в персист+мердж».
- `data-model.md` — задокументировать новую колонку `TranscriptTrack.segments`.
- Реестр «не-сделано» — строку ASR word-timestamps переформулировать: «сегментные тайминги доставлены (Tier 0); word-level — Tier 1, запрос к agent-lia».
- `prod-deploy-log.md` Шаг 4 — запись о новой колонке (миграция авто на `up`).
**Что НЕ входит:** удаление лога `vox.no_words` целиком (оставить как сигнал реально пустых).
**Acceptance:**
- `grep -n "extendedResult" backend/src/modules/ai/services/vox.service.ts` в блоке vox.no_words → найдено.
- second-brain файлы содержат обновления (греп по `TranscriptTrack.segments`).
**Закрывает:** трассируемость + DoD-производные заметки.

## Риски / Pre-mortem (ревью-аспекты для `strict-production-review-gate`)
- **Единицы:** сегменты Vox — СЕКУНДЫ (float); в merge переводим ×1000 в мс. Риск спутать с мс → проверить, что `startMs=round(startSec*1000)` (не `startSec` напрямую). Ревью: грепнуть `*1000` в развилке.
- **Идемпотентность merge:** `turns!==null → skip` (существующее). Старые встречи с уже сломанными turns не «чинятся» автоповтором — это ожидаемо (Б6); новые строятся правильно с первого раза.
- **Старые дорожки:** `segments=null` → ветка `rawSegments.length>0` ложна → корректный откат на `transcriptText`-резерв. Проверить, что `(track.segments ?? [])` не падает на null.
- **Overlap:** одновременная речь двух дорожек → сегменты сортируются по start, turn флашится по смене спикера → читаемая последовательность; crosstalk считается калькулятором по пересечению turn-времён (корректно).
- **Prisma Json типизация:** `track.segments` приходит как `Prisma.JsonValue` → каст `as Array<{startSec,endSec,text}>` (как уже сделано для `words`). Ревью: тип не `any`-течёт дальше.

## Прод-деплой
- **Единственная прод-операция:** миграция `transcript_track_segments` — применяется **автоматически** на `docker compose up -d` (через `prisma migrate deploy` в migrate-контейнере). Ручных шагов нет.
- Нет новых ENV, seed/patch/backfill/migrate-скриптов, очередей, эндпоинтов → `apply-prod-deploy.ts STEPS` **не трогаем**.
- `prod-deploy-log.md` Шаг 4 — добавить строку про колонку (Фаза 5).

## Совместимость с prompt caching
Не релевантно — LLM-промпты не затрагиваются (правка ASR-пайплайна и БД).

## DoD (общий чек качества)
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные.
- `bunx vitest run` по затронутым spec'ам (transcribe/merge/behavior) — зелёные.
- second-brain обновлён по таблице производных заметок (data-model.md — новая колонка; code-pitfalls.md; реестр не-сделано).
- `prod-deploy-log.md` Шаг 4 обновлён (миграция).
- Рефлексия в `second-brain/05_история/` после push.
- Прод-подтверждение (после выката): свежая встреча >1 мин, ≥2 спикера → транскрипт переплетён, «всего речи» ≈ длительности, нет плашки «низкое качество», в логах нет `vox.no_words` на встречах с речью (анализ §6).

## Итог
*(заполнит tz-orchestrator после реализации: что сделано целиком/частично, что осталось, коммиты по фазам.)*
