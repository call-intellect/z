---
date: 2026-06-03
tags: [meetings, recordings, transcript, ai-pipeline, bug]
distilled: false
---

# Транскрипт во фронте + пробелы записи (дорожки/участники/видео)

## Что было поставлено

Разбор боевой тестовой встречи `01KT65ZKXJRHXMT5GC4N51E52C` на проде. Симптомы:
1. Видео не проигрывается (плеер крутится).
2. Аудиодорожек 2 вместо 3, одна почти пустая (38 сек).
3. Список участников — 6 вместо 3.
4. Транскрипт не подтягивается во вкладку («ещё не готов»).

Владелец явно указал: он лично был на встрече и **слышал всех троих** — микрофоны работали. Просьба: починить то, что точно знаем; остальное оформить в анализ; зафиксировать, что вопросы дорожек/участников НЕ решены.

## Как решал

**Починил транскрипт (4+1 файла), коммит — см. git:**
- Корень A: эндпоинт `GET /meetings/:id/transcript` отдавал presigned-URL, а фронт (`TranscriptApiResponse`) ждёт `{ turns }`.
- Корень B: `MergeWorker` писал диалог только в БД-колонку `Transcript.turns`, но **не зеркалил `merged.json` в S3 и не проставлял `mergedS3Url`** → `/transcript` падал в 404 (`getTranscript` требует `mergedS3Url`), а `behavior-metrics`/`quality-score`/`custom-report` пропускались («нет merged.json»). При этом `analyze.worker` уже читает `turns` из БД и работал — отсюда и рассинхрон (незавершённый рефактор «turns в БД»).

Правки:
- [s3-keys.ts](../../backend/src/modules/recordings/s3-keys.ts) — `transcriptMergedKey()`.
- [merge.worker.ts](../../backend/src/modules/ai/workers/merge.worker.ts) — инжект `S3Service`; в основном и идемпотентном путях зеркалит `merged.json` + проставляет `mergedS3Url` (метод `ensureMergedJsonMirror` = backfill для встреч, смерженных до фикса).
- [transcript-cleaning.service.ts](../../backend/src/modules/ai/services/transcript-cleaning.service.ts) `getTranscript` — отдаёт `turns` из БД (cleaned=false) / из `cleaned.json` (cleaned=true), формат `DialogTurn` = фронтовый `TranscriptTurn` 1:1.
- [meetings.controller.ts](../../backend/src/modules/meetings/meetings.controller.ts) — тип ответа на `{ turns, durationSeconds, cleaned }`.
- [merge.worker.spec.ts](../../backend/src/modules/ai/workers/merge.worker.spec.ts) — DI-мок S3.

**Остальное — анализ (НЕ починено):** `plans/analysis/2026-06-03-meeting-recording-tracks-participants-gaps.md`.
- 6 участников = нестабильный `livekitIdentity` гостя на реконнектах (`onParticipantJoined` плодит строки).
- 2 дорожки = реактивно-гоночное создание per-track egress: `ensureTrackEgress` срабатывает только на `track_published(audio)` и только при активной записи; треки, опубликованные до старта записи или под реконнект — теряются (второго `track_published` нет). Composite пишет полный микс — поэтому всех было слышно, но per-track вход транскрибации неполный.
- Видео = большой MP4, вероятно без fast-start (moov в конце) → плеер тянет весь файл. Нужен замер заголовков.

## Что вышло (верификация)

- `bun run typecheck` — зелёно.
- `bunx vitest run merge.worker.spec.ts` — 4/4, лог подтверждает зеркалирование merged.json.
- `eslint` изменённых файлов — чисто (одно предсуществующее предупреждение в контроллере не трогал).
- Боевая проверка на проде — **не делалась** (нужен ре-merge встречи или новая встреча).

## Чему научился / зафиксировать

- **«turns в БД» — канон после рефактора** (`analyze.worker` читает `meeting.transcript.turns`), но не все потребители переведены: `behavior-metrics`/`quality-score`/`custom-report`/эндпоинт `/transcript` остались на `mergedS3Url`. Поэтому merge обязан зеркалить merged.json.
- **Per-track аудиодорожки ≠ composite.** «Слышно всех» (composite) не значит «дорожки собрались». Транскрибация идёт по per-track, поэтому баг дорожек = деградация транскрипта/AI.
- **НЕ закрыто, держать в фокусе:** аудиодорожки (теряются на гонке/реконнекте), участники (дубли по identity), видео-плеер на больших файлах. Владелец просил помнить про «две дорожки/участника» — это открытый системный вопрос надёжности записи.

## Открытые хвосты
- [ ] Замер заголовков `composite.mp4` (видео).
- [ ] Тест 3 участника + реконнект (воспроизвести потерю дорожек).
- [ ] ТЗ «надёжность per-track записи» (проактивный догон треков + стабильный identity гостя).
- [ ] (опц.) backfill merged.json для старых встреч.
