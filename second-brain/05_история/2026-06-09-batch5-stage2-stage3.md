---
title: Батч 5 — Stage 2 (дашборды) + Stage 3 (загрузка/импорт документов + загрузка встречи с диаризацией)
date: 2026-06-09
type: reflection
branch: feature/2026-06-08-daily-value-dashboards-uploads
covers: ТЗ-2 (состав дашбордов) ⊕ ТЗ-3 (modern-визуал), ТЗ-4 (manual-document-upload-and-import), ТЗ-5 (meeting-upload-diarized-speaker-mapping)
---

# Батч 5 — Stage 2 (дашборды) + Stage 3 (документы + загрузка встречи)

## Что было поставлено

Оркестрация большого батча из 32 коммитов на ветке `feature/2026-06-08-daily-value-dashboards-uploads`. Три направления:

**Stage 2 — дашборды (ТЗ-2 «состав» ⊕ ТЗ-3 «современный визуал», накладываются на каждый экран):**
- S2.1 главная `/dashboard`: первый экран сжат до ≤7 величин (ValueStrip + чат/настроение/обещания/висящие решения + вердикт компаса целей + AI-сводка + Top-1 риск), гейт `dashboard.main_rework.enabled`; 5 новых modern-виджетов; backend `fetchValueStrip` + `reasonSourceRef` + `mainReworkEnabled` в director DTO.
- S2.2 COO `/dashboard/operations`: overview += «сколько закрыли» (blockers/frictions resolved), `TeamCapacityWidget`/`ChronicBlockersWidget`, флаг `operations.dashboard_rework.enabled`.
- S2.3 дайджесты: daily += хронические блокеры (runtime из `BlockerSynthesis`); weekly += дельты секций vs прошлая неделя + рендер topIdeas.
- S2.4 план-факт по людям: «обещал, без ответа» + «мало данных» в надёжности; дедуп задач-из-обещаний (`Task.evidenceBlockIds`); self-view `GET /me/weekly-per-person`, флаг `operations.per_person_self_view.enabled`.
- S2.5 `/me` 5→9 виджетов: 4 новых (память-помогла-мне / мой план-факт / судьба моих идей / входящие признания); backend `GET /me/ideas` + `GET /me/recognitions` (`MyDailyValueController`); кнопки 👍/👎 на ответах чата (chat-v2 setFeedback/clearFeedback); флаг `me.daily_value_widgets.enabled`.
- S2.6 два новых дашборда: `/dashboard/portfolio` (здоровье портфеля целей + MoSCoW) и `/dashboard/value-recap` (экран поверх месячной витрины S1.5 + экспорт слайдов/печать).
- S2.7–S2.9 визуал: `/goals`,`/actions`,`/maturity` на modern; modern-фон админки (`AdminShell`); perf-fallback `prefers-reduced-transparency` в tokens.css.

**Stage 3 ТЗ-4 — загрузка/импорт готовых документов** (модули `documents` + `ingest` + `knowledge-core`): новые форматы (xlsx/pptx/html/rtf/odt/csv через officeparser+ExcelJS), мультифайл-загрузка + дедуп `contentHash` + явная привязка (тема/проект/должность с пробросом в граф), массовый импорт ZIP/Notion (`POST /documents/import-zip`) + Confluence (`POST /documents/import-confluence`), AI-подсказка привязки (`document-attribution-suggest`, human-in-the-loop accept), документ-источник в citations чата.

**Stage 3 ТЗ-5 — загрузка готовой встречи с диаризацией** (новый модуль `meeting-uploads`): presignPut → `POST /meetings/upload`(+complete) → ffmpeg-нормализация (любой формат) → Vox-диаризация → гейт `awaiting_speakers` (БЕЗ анализа) → ручная разметка говорящих (`GET/PUT /meetings/:id/speakers` + `POST /speakers/confirm`) → enqueue анализа как у обычной встречи. Рубильник `MEETING_UPLOAD_ENABLED` + квота `billing.meetingUploadsPerMonth`.

## Как решал

- **Оркестрация фаза→кодер→приёмка→коммит** в одном направлении за раз (S2.1a backend → S2.1b фронт → … → S3.3). 32 коммита, каждый с зелёной верификацией перед следующей волной.
- **Ключевое решение D1 (наложение ТЗ-2 на ТЗ-3):** состав/гейт/инфоблоки — гейтятся флагом `*_rework.enabled`, а modern-визуал применяется **безусловно** (визуальный слой не требует флага — он не меняет данные, только подачу).
- **officeparser v7 API:** функция называется `parseOffice` (не `parseOfficeAsync`, как в старых версиях) — пойман через Context7/исходник; ловушка зафиксирована.
- **Confluence-токен:** передаётся в job **crypto-encrypted** (не в открытом виде в payload очереди) — `confluence-client.ts`.
- **Слияние говорящих:** через поле `MeetingUploadSpeaker.mergedIntoLabel` (а не удаление записи) — сохраняет провенанс «эти две дорожки = один человек».
- **Дедуп задач-из-обещаний:** через `Task.evidenceBlockIds` (обещание, ставшее задачей, считается один раз).
- **`goal_priority_moscow`:** новая enum `GoalPriority` + `Goal.priority` + модель `PortfolioHealthSnapshot` + cron `PortfolioHealthSnapshotCron @Cron('0 5 * * 1')` + `PATCH /goals/:id/priority`.

## Что вышло

- Все фазы: `typecheck` / `lint` / `build` зелёные на backend и frontend; per-фазные `.spec` написаны (portfolio-health.service.spec, document-import.service.spec, document-attribution.service.spec, meeting-uploads.service.spec, my-daily-value.controller.spec и др.).
- 4 миграции созданы **файлами** в `prisma/migrations/`, но **не применены к живой БД** (dev-БД не поднята; на прод применятся авто через `migrate deploy` в migrate-контейнере): `20260608190000_goal_priority_moscow`, `20260608200000_documents_formats_type_attribution`, `20260608210000_document_import`, `20260608220000_meeting_upload_diarization`. Все аддитивные.
- Не закоммичено агентом самостоятельно (commit/push — по подтверждению владельца).

## Чему научился

- **`typecheck` включает `.spec` и ловит то, что `vitest` пропускает.** В documents-spec был тип-баг, который прошёл бы `vitest run` (тест не вызывал путь), но `tsc --noEmit` его поймал на этапе приёмки фазы — урок: typecheck приёмки фазы обязателен, не полагаться только на прогон тестов.
- **Фактчек отчётов кодера обязателен.** Кодер отметил фазу `[x]`, но при грепе вскрылся **DTO-пробел `docType`** (поле не пробрасывалось в ответный DTO) — нашлось только сверкой кода с контрактом ТЗ. Подтверждает правило «агенты могут лгать про [x] — грепать факт».
- **officeparser v7** — постинстал-скрипт (`postinstall`) у пакета блокируется Bun'ом в этом окружении; нужно проверить на прод-сборке Docker (нативная сборка). Зафиксировано в реестре «не сделано».
