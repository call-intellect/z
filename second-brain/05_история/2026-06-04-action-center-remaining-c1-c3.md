---
date: 2026-06-04
title: Action Center — остаток ТЗ (C1 метка доверия / C2 крутилки AdminSetting / C3 detail-страницы курации)
---

## Что было поставлено

Закрыть остаток ТЗ Action Center в worktree `z-action-center` (ветка `feature/action-center-trust-ladder`):

- **C1 — метка доверия (trust ladder).** Пробросить уровень доверия карточки (`trustTier`, источник `CardVersion.currentVersion`) во все read-пути регуляций/решений/процессов/политик и в provenance документа; на фронте показать значок доверия (`TrustBadge`) на соответствующих страницах.
- **C2 — крутилки в AdminSetting.** Вынести платформенные дефолты курации и напоминаний из code-констант в редактируемые `AdminSetting` (super_admin) с цепочкой `cache → ENV → default` и code-fallback, без новых ENV.
- **C3 — detail-страницы курации.** Доделать фронт детальных страниц курации карточек и конфликтов с решениями куратора и резолюцией конфликтов; провайдеры должны вести deep-link на эти страницы.

## Как решал

Оркестрация суб-агентами в изолированном worktree `C:/work/z-action-center` (отдельная ветка от main, чтобы не мешать параллельным сессиям). На изолированной ветке БД не трогал: `prisma:generate`-only без `db push` — схему не меняли, нужен был только сгенерированный клиент для typecheck.

**C1 (коммит c8799f86).** Поле `trustTier` протянуто в read-DTO:
- `regulations.service`, `decisions.service` (включая supersede-chain — цепочку замен), provenance документа (`documents.service` / dto + мапперы в контроллере).
- Фронт: компонент `frontend/src/ui/components/shared/TrustBadge.tsx` (`provisional` → warning «Не проверено человеком», `auto` → sand «Авто», `human` → ничего) на `/regulations`, `/decisions` (список + деталь) и вкладке «Извлечённые сущности» документа.
- Попутно починен pre-existing баг контракта документов: `byId` трансформирует `extractedEntities` → `entityGroups`, из-за чего вкладка «Извлечённые сущности» крашилась раньше (рассинхрон имён полей DTO).

**C2 (коммит 4d72ead8).** 14 платформенных дефолтов вынесены через `TypedConfigService.resolveSync`:
- 9 `knowledge.curation.*` (`provisionalThresholdDefault` 0.8, `aiVerifierEnabled` true, `auditSampleRate` 0.05, `autotuneEnabled` false, `thresholdMin` 0.6, `thresholdMax` 0.97, `autotuneStep` 0.02, `minDecisionsForAutotune` 20, `maxProvisionalOverride` 0.2) + переключены `autoThreshold` / `deepReview`.
- 5 `pendingActions.*` (`reminderWindowStartHour` 9, `reminderWindowEndHour` 21, `reminderStepHours` 3, `urgentAgeDays` 5, `reminderLeadDays` 3).
- Курация читается через единую `normalizeSettings` (`cfg.curation`) — покрывает триаж + autotune; напоминания — `cfg.pendingActions` в reminder-cron и всех 3 провайдерах (curation / conflict / intake).
- Зарегистрированы в `admin-setting-schema-registry.ts`, засижены в `seed-admin-settings.ts` (уже в `apply-prod-deploy`). `per-Org curationSettings` не тронут. Новых ENV нет (admin-only).

**C3 (коммит ce4052dd).** Фронт detail-страниц:
- `/curation/[id]` (`CurationDetailClient` — решение куратора, 8 `decisionType`, `reasoning` обязателен при deep / структурных решениях).
- `/curation/conflicts` (список) + `/curation/conflicts/[id]` (резолюция `accept_new` / `keep_old` / `merge` / `evolving` + `dismiss`).
- Backend и слои `curation.api.ts` / `domain/curation.ts` были готовы. `actionUrl` провайдеров переведён на deep-link (`/curation/${i.id}`, `/curation/conflicts/${i.id}`).
- Роль-гейт: карточка — owner/admin + candidate + superadmin; конфликты — строго owner/admin.

**Адверсариальное ревью (4 воркфлоу, фикс-коммит c17d9b14).** Каждую фазу прогнал через состязательное ревью; найденные пробелы закрыты.

## Что вышло

- Верификация зелёная: backend `typecheck` + `build`; frontend `typecheck` + `lint` + `build`; тесты — 319 в curation + pending-actions + admin, 15 фронт-спеков C3.
- 4 адверсариальных ревью-воркфлоу нашли **5 реальных пробелов**, все закрыты:
  1. краш вкладки документа (`extractedEntities` vs `entityGroups`) — C1;
  2. рассинхрон `urgentAgeDays` в conflict / intake (дефолт не дотягивался) — C2;
  3. ложный доступ `coo` к карточке курации (`policy.csv`) — C3;
  4–5. остальные пробелы триажа/доступа, закрытые в том же фикс-коммите.
- Все 4 фазы прошли приёмку; ветка готова к мержу. Найденные пробелы, выходящие за рамки C1–C3 (цитаты chat-v2 и кнопка «Это неверно»), вынесены полноценными суб-ТЗ D / E, а не оставлены как «осознанная отсрочка».

## Чему научился

1. **Адверсариальные ревью-воркфлоу окупаются.** Каждый из 4 проходов нашёл реальный дефект, а не косметику: краш документа (`entityGroups` vs `extractedEntities`), рассинхрон `urgentAgeDays` сразу в 3 провайдерах, ложный доступ `coo` по `policy.csv`. Без состязательного прохода эти баги ушли бы в прод — обычный self-review их не ловил, потому что код «выглядел правильным».

2. **«Чини класс, не кейс».** Подтвердилось трижды: `trustTier` нужно протянуть по ВСЕМ read-путям (regulations / decisions / supersede-chain / provenance), а не только в одном DTO; `urgentAgeDays` — во ВСЕХ 3 провайдерах напоминаний, иначе рассинхрон; parse-fallback везде должен падать на admin-дефолт, а не на хардкод. Один симптом — но корень в конструкте, который размножен по коду; искать все вхождения сразу.

3. **`normalizeSettings` как единая точка миграции дефолтов курации.** Вынос 9 `curation.*` сделан в одной функции `normalizeSettings(cfg.curation)`, и autotune получил новые значения «бесплатно» — он читает через `getSettings`, поэтому крон трогать не пришлось. Единая точка нормализации = миграция дефолтов в одном месте без правки потребителей.

4. **Грабля Workflow-скрипта: литерал `${id}` в backtick-строке промпта.** В оркестрационном скрипте подстановка `${id}` внутри template-literal промпта интерпретируется JS как переменная → `ReferenceError`. Экранировать (`\${id}`) или писать route-нотацией `[id]` (как в Next.js App Router). Внешне это «строка для агента», но движок шаблонов её раскрывает раньше.

5. **Пробелы — полноценными суб-ТЗ, а не комментарием «потом».** То, что не входит в C1–C3 (цитаты chat-v2, кнопка «Это неверно» — UI-кнопки и карточек-как-цитат в коде не существует), оформлено отдельными суб-ТЗ D / E с контрактом. Это не «осознанная отсрочка» в чате, а зафиксированная единица работы, которую можно взять в оркестрацию без археологии контекста.
