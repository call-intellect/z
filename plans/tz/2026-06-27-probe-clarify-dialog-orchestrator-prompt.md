# Orchestrator-prompt: probe-clarify-dialog

Запуск `tz-orchestrator` для реализации `plans/tz/2026-06-27-probe-clarify-dialog-tz.md`.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-first, без комментариев в коде, миграции-файлы, крутилки в AdminSetting, Ship-On).
2. `second-brain/index.md` → `01_projects/probe-agent.md` + `01_projects/probe-observers-catalog.md` (как работает probe целиком и петля ответа).
3. ТЗ целиком: `plans/tz/2026-06-27-probe-clarify-dialog-tz.md`.
4. Анализ (доказательная база, при сомнении в «почему»): `plans/analysis/2026-06-27-probe-clarify-dialog-reliability.md` §6–§8.

## Код-якоря (перечитать перед правкой — номера строк дрейфуют)
- `backend/src/modules/probe/probe-response.handler.ts` — apply-методы, `tryClassifyResponse`, `@OnEvent('notification.responded')`.
- `backend/src/modules/probe/prompts/probe-response-classify.prompt.ts` — схема классификатора (расширяем до `probe_response_intent_v1`).
- `backend/src/modules/probe/existence-confirm.util.ts` — `mapExistenceConfirmAnswer` (выводим из пути применения, оставляем как fallback).
- `backend/src/modules/conversational/conversational.service.ts` — `respondToProbe` (финализация/эмиссия `notification.responded`, проверка `not_recipient`).
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` + `.../max-bot/max-bot.adapter.ts` — `findOpenProbe`, `InboundMessage {type:'response'}`.
- `backend/src/modules/dialog-layer/services/query-classifier.service.ts` — `openProbeQuestion`/`probe_reply`.
- `backend/prisma/schema.prisma` — `enum ProbeStatus` (~6486), модель `ProbeEvent`; добавляем `ProbeDialogState`/`ProbeDialogPhase`.
- `backend/src/common/config/typed-config.service.ts` (~1162 `cfg.probe.*`) + `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (~167 секция `probe.*`) + `seed-admin-settings.ts` — крутилки Б6.

## Инструменты
- vexp `run_pipeline` первым по каждой фазе; `get_skeleton` для осмотра. Демон жив → Grep/Glob заблокированы; для backend-добора — Bash `grep`/`sed`/`find` + Read.
- Context7 для внешних либ (Prisma 7, nestjs-zod) при сомнении в API.

## Граф фаз (строгий порядок)
```
Ф1 (фундамент apply, независима) → Ф2 (intent + ProbeDialogState) → Ф3 (clarify-ход) → Ф4 (echo-back)
                                                                          └─► Ф5 (мост ботов + дайджест)
Ф6 (терминалы + метрики + degradation) — финал, после Ф3–Ф5
```
Одна фаза = одна волна суб-агента. Ф1 можно стартовать сразу; коммит по фазам; push по подтверждению владельца.

## Факт-чек (не верь отчёту суб-агента)
Каждую фазу принимай независимо: re-Read изменённых файлов, прогон `bun run typecheck && bun run lint && bunx vitest run <файл фазы>`, греп маркеров из Acceptance фазы. «Фаза закрыта» = все предикаты Acceptance зелёные + `Закрывает: Rn` подтверждено.

## Ключевые инварианты (провал = блокер)
- LLM **не пишет в данные**; запись только детерминированным apply-слоем; идемпотентно; echo-back перед записью.
- `outcome=unclear` → **ноль мутаций**.
- confidence только маршрутизация; порог — AdminSetting per-tenant.
- Один путь записи (не вводить write-tools Мастера на probe-домены).
- Адресность (`not_recipient`), tenant, dataClass сохранены.
- Inline-кнопки в probe запрещены (текст/голос-ASR).
- `concierge.service.ts` в этой итерации НЕ трогаем (полный Мастер — vNext).

## Failure-modes
- Не расширять scope на домены вне 5 (В4) и на полный диалоговый Мастер (В1) — это vNext.
- Не заменять идемпотентные `updateMany`-условия на слепые перезаписи.
- Не вводить флаг «дефолт OFF» — `probe.dialogEnabled` это kill-switch ON (Ship-On).

## Заметки для владельца (НЕ копировать в запуск)
ТЗ `status: ready-to-implement`. Реализацию начинать только по явному «начни реализацию». Прод-операции — после реализации, по `prod-deploy-log.md` (миграция + сид крутилок + smoke).
