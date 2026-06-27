---
type: reflection
date: 2026-06-27
feature: probe-clarify-dialog
branch: feature/probe-clarify-dialog
related:
  - plans/tz/2026-06-27-probe-clarify-dialog-tz.md
  - 01_projects/probe-agent.md
---

# Рефлексия — диалоговое уточнение probe-ответов (probe-clarify-dialog)

## Что было поставлено
Превратить одноразовую петлю проактивного вопроса Коры (probe спросил → человек ответил один раз → код применил) в надёжный диалог на масштабе сотен компаний. ТЗ `plans/tz/2026-06-27-probe-clarify-dialog-tz.md`, 6 фаз. Принцип: **LLM решает ЧТО человек имел в виду; код решает КАК записать; человек подтверждает echo-back перед записью.** Запись — только через существующий детерминированный идемпотентный apply-слой, один путь. Роль: оркестратор (`tz-orchestrator`) — код руками не писал, вёл фазы суб-агентами с независимой приёмкой.

## Как решал (фазы, файлы, коммиты)
- **Ф1 `12581516`** — фундамент apply: схема `probe_response_intent_v1` (`reasoning`/`outcome`/`value`/`confidence`, reason-then-constrain); ветвление по `outcome` вместо подстроки «удал»; `unclear`→ноль мутаций; идемпотентность set-once (`decision.overdue deadline:{not:due}`, дедуп урока эксперимента, дедуп описания, `companyprofile` getRaw-guard); `mapExistenceConfirmAnswer` → только degraded-fallback.
- **Ф2 `0cb7f63b`** — `ProbeDialogState` (`probeEventId @unique`, 1:1), enum `ProbeDialogPhase`, +4 `ProbeStatus`, миграция `20260627000000_probe_dialog_state` (рукописная — локальной БД нет), `ProbeDialogService` (ensureState/getActive/recordTurn/setPhase, позже finalizeIfPending).
- **Ф3 `8ab2d22d`** — крутилки Б6 + eventType `probe.clarify`; эскалация в clarify (low-conf/counter_question/refine/unclear → один уточняющий ход; turnCount>maxTurns → escalated_to_human owner/admin); переуказание `dispatchedNotificationId` для round-trip доответа.
- **Ф4 `77cc81a5`** — eventType `probe.confirm` + echo-back; `finalizeIfPending` (CAS — применить ровно один раз); детерминированный `isAffirmation`; применяется СОХРАНЁННОЕ намерение из `ProbeDialogState`, не текст «да».
- **Ф5 `63aa03a9`** — `ProbeResponseInboundBridge` (`subscribeInbound('response')` — раньше отсутствовал, ответы ботов терялись); адресность дайджеста (`resolveDigestProbeEventId`); `findOpenProbe` += clarify/confirm.
- **Ф6 `68b1cab2`** — метрики `probe_dialog_{transition,outcome,degraded}_total`; graceful degradation (LLM упал → детерминированный one-shot + метрика); cron `ProbeDialogTtlCron` (awaiting_* → abandoned).
- **Docs `8bbdd57e`** — second-brain (probe-agent/data-model), feature-flags, prod-deploy-log, реестр не-сделанного + 2 vNext-заглушки.

## Что вышло (верификация)
`typecheck`/`lint`/`build` зелёные (build подтвердил DI новых @Cron/bridge/providers). vitest: probe **298** + conversational **273**. Миграция аддитивная, `prisma validate` ок (apply на проде через `migrate deploy`). Все R1–R17 закрыты. Push кода — выполнен (fast-forward, 0/0). Рефлексия — отдельным пушем.

## Чему научился (грабли и решения)
1. **`\b`/`\w` в JS-regex не работают с кириллицей даже с флагом `u`.** Кодер Ф4 поймал: мой `isAffirmation` из промпта (`^(да)\b`) падал на «да», негация `\b(нет)` не ловила «нет, …». Замена: `(?:^|[^а-яёa-z])…(?![а-яёa-z])`. **Урок:** для русских строковых матчей всегда эмулировать границу слова через символьные классы; проверять прямым прогоном (я доказал 19/19 кейсов отдельным скриптом, а не верил отчёту).
2. **Миграция без локальной БД.** `.env`/Postgres локально нет → `prisma migrate dev` нельзя. Решение: рукописный файл-миграции 1:1 с форматом генератора Prisma + `prisma validate` + `prisma generate` (работает без БД — фолбэк `DATABASE_URL ?? ''` в `prisma.config.ts`). Apply — на проде `migrate deploy`. **Урок:** для probe-задач это штатный путь, не блокер.
3. **`getDynamic`/AdminSetting — глобальные, не per-tenant.** ТЗ писал «порог per-tenant», но инфра `resolveSync`/`getDynamic` читает глобальный ключ. Зарегистрировал как все probe-крутилки (глобально), «per-tenant» — задел. **Урок:** сверять словесные требования ТЗ с реальной сигнатурой инфры.
4. **Состязательное ревью ловит то, что зелёные тесты пропускают.** На Ф3 ревью-агент нашёл orphan-pending уведомление эскалации (мой внесённый дефект — responseStatus='pending' у терминального FYI); на Ф5 я сам нашёл within-tenant обход адресности (explicit `probeEventId` без гарда `dispatchedNotificationId`). Оба — НЕ ловились тестами. **Урок:** для FSM/мутаций/адресности обязателен отдельный adversarial-проход; «зелёное» ≠ «верно».
5. **Дефолт флага в тестах — источник скрытой хрупкости.** Ф3-кодер оставил `dialogEnabled` дефолт `true` → Ф1/Ф2 apply-тесты проходили «по совпадению» (ассертили 0-мутаций). Ф4 (clear apply → confirm) их бы сломал. Перевернул дефолт makeHandler на `false` (сохраняет Ф1/Ф2 семантику), диалог-тесты ставят `true` явно. **Урок:** дефолт мока должен отражать degraded-путь, фичу включать точечно.
6. **Параллельная сессия на той же ветке.** Владелец параллельно коммитил docs другой фичи в `feature/probe-clarify-dialog` + держал uncommitted WIP в `probe-agent.md`/`index.md` + untracked `probe-observers-catalog.md`. Не трогал их файлы (index.md/каталог), коммитил только своими явными путями, push — чистый fast-forward (0 behind). **Урок:** на общей ветке — только явные пути, `index.md`/чужой untracked не стейджить, перед push проверять ahead/behind.

## Незакрытое (vNext / follow-up)
В `04_не-сделано/README.md`: полный диалоговый Мастер (В1), применение для доменов без apply (В4); follow-up'ы — дайджест закрывается после одного ответа, ответ owner на эскалацию не авто-применяется, curation не материализует rename, existence-confirm owner-assign только в degraded.
