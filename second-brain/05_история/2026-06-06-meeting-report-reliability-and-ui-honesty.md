---
title: "Надёжность и честность отчёта встречи — ТЗ из 6 фаз (404 primary, гонка fast, задачи, ASR word-ts, честный UX)"
date: 2026-06-06
tags: [meetings, ai-report, knowledge-core, vox, asr, frontend, ui-honesty, reliability, tz-orchestrator]
---

# Надёжность и честность отчёта встречи (ТЗ `2026-06-06-meeting-report-reliability-and-ui-honesty`)

## Что было поставлено
Реализовать ТЗ из 6 фаз по результатам QA-разбора боевой встречи `01KTDHPTHS9T5YGXFANKES765J`: страница `/meetings/[id]/result` теряла данные и вводила в заблуждение. Ветка `sergdev`, коммиты по фазам. По ходу владелец добавил отдельную задачу — расследовать баг дублирования счётчика участников.

## Как решал (оркестрация суб-агентами + независимая приёмка)
Каждая фаза: моя картография (re-Read реального кода, line-номера ТЗ дрейфуют) → самодостаточный промпт кодеру → независимая приёмка (греп-маркеры + re-Read + свой typecheck/lint/build/тесты, НЕ верю отчёту агента) → ревью → коммит по фазе.

- **Ф1 бэкенд-надёжность** (`a76b0445`): S6-07 — `meeting-reports.get()` синтезирует primary из `AiResult` по `aiResult.id` (раньше искал только `meetingReport` → 404 на «Открыть»). S6-01 — `summaryFast` через атомарный `upsert` по `meetingId` вместо ветвления по snapshot-флагу `hasAiResult` (TOCTOU → Unique constraint). **Класс-фикс расширил сам:** `analyze.worker.upsertEmptyAiResult` тоже был `findUnique`+`create` (тот же класс гонки) → тоже атомарный upsert. S6-08 — имя спикера из `Participant.name` (fallback «Участник») вместо хардкода «Participant».
- **Ф2 задачи** (`ccb2dd00`): `pickPrimaryTasks` больше не «есть fast → только fast», а merge fast+main с дедупом по `trim+lowercase` (было видно 1 из 6). Журнал-превью переведён с устаревшего пустого `aiResult.tasks` на `useMeetingTasks`+`pickPrimaryTasks`.
- **Ф5 UX-чистка** (`35b0304a`): единый модуль `structured-report.tsx` (русские заголовки + человекочитаемый рендер, задачи списком, пустые секции скрыты, ноль сырого JSON) для Обзора и диалога; плюрализация «реплик»; убрана вкладка-дубль «Заметки». **S6-11 — поймал ложную премису ТЗ:** вкладка «Чат» это чат КОМНАТЫ (живые сообщения встречи), а НЕ дубль AI-панели (премиса устарела после мержа chatBox). Спросил владельца → решение: переименовать «Чат»→«Чат комнаты», НЕ удалять.
- **Ф4 честность** (`b9d78afb`): `fmtDurationCompact` суб-минута → «<1 мин» (не «0м»); `durationMs` трактует `meeting.durationMs===0` как отсутствие → fallback на запись; `MeetingBehaviorSection` при нулевом сигнале речи показывает «недоступна для этой записи» вместо таблицы нулей/«Тишина 100 %».
- **Ф6 block-linker** (`f3ba3ce1`): устойчивость УЖЕ была (strict json_schema + ретрай + `tryParseJson` + fallback); добавил недостающую метрику `kc_block_linker_invalid_json_total` (доля грязного JSON per-attempt).
- **Ф3 ASR** (`c26348df`, research): диагностика по коду — submit не шлёт флаг word-ts (не трогал, риск 400); `parseVoxResult` не покрывал `segments[].words` → добавил; инструментировал лог `vox.no_words` (PII-safe форма ответа) для подтверждения корня на след. встрече. Фаза 4 (честный UX) — основной ответ, пока корень не подтверждён на проде.

## Что вышло (верификация)
- 7 коммитов в `sergdev`, каждый: typecheck (вкл. .spec) + lint 0 errors + build (backend `tsc -p` / frontend Next) + тесты — все зелёные сам видел.
- Новые тесты: get-primary→200 + unknown→404, writeSummary-upsert; pickPrimaryTasks merge/dedup; structured-report label/empty; fmtDurationCompact + hasBehaviorSignal; block-linker invalid-json-retry; vox `segments[].words`. Регрессий нет (ловил `analyze.worker.spec` — мок не знал `upsert`, вернул агенту → починил).
- Баг участников: запустил фонового агента → доказанный root cause (нет дедупа по человеку: уникальность только по `livekitIdentity`, invite-строка `invitee:` + join-строка `guest:` не схлопываются; счётчик = сырой `participants.length`; хост+2 invite+2 join = 5). Оформил ТЗ `plans/tz/2026-06-06-participant-count-dedup.md` (needs-owner-go: семантика счётчика + DB-инвариант — решения владельца).

## Чему научился
- **«Фикс класса» в чужом файле — это норма для оркестратора.** ТЗ называл upsert только в fast-воркере; реальный второй писатель `aiResult` (`analyze.worker`) имел тот же TOCTOU. Починил оба — иначе гонка просто переезжает.
- **ТЗ может опираться на устаревшую премису — проверять перед удалением данных.** S6-11 «вкладка-дубль» оказалась реальным чатом комнаты (после мержа chatBox). Удаление = потеря данных. Доказал кодом, спросил владельца. См. [[../02_architecture/code-pitfalls]] §«Два разных чата встречи».
- **`x ?? fallback` НЕ ловит `x===0`.** `meeting.durationMs ?? recording` оставляло «0» как длительность. Нужно `x && x>0 ? x : fallback`. Грабля честности UI.
- **Research-фаза без прод-доступа — фиксируй корень там, где можешь (additive-фикс + инструментация), не угадывай рискованное.** `segments[].words` — почти универсальная ASR-форма, добавить безопасно; submit-параметр — угадывать нельзя (как `language`→400). Лог формы ответа доберёт правду на след. встрече.
- Параллельные сессии реально мешают: `second-brain/04_не-сделано/README.md` был занят чужой незакоммиченной правкой → строку реестра про word-ts отложил, вывод записал в тело ТЗ.
