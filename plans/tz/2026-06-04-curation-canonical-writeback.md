---
type: tz
status: needs-owner-go
date: 2026-06-04
owner: sergrv80@gmail.com
branch: feature/action-center-trust-ladder
relates_to:
  - plans/archive/2026-06-03-knowledge-card-correct.md
  - backend/src/modules/curation/services/curation.service.ts
  - backend/src/modules/regulations/services/regulations.service.ts
  - backend/src/modules/decisions/services/decisions.service.ts
phases:
  - F1
---

> **Статус:** требуется «погнали» владельца — затрагивает **ядро** `CurationService.decide()` (высокий blast-radius: вся курация всех типов карточек). Создано как фиксация архитектурного пробела, вскрытого при реализации **Фазы E1** ТЗ `2026-06-03-knowledge-card-correct.md`.

# Курация: применение одобренной правки к каноническим таблицам (write-back)

## 0. Откуда взялось (контекст)

Фаза E1 дала обычному сотруднику путь «Исправить» через **предложение** (анти-вандализм): `CurationService.submitProposal()` создаёт `CurationItem(level=light, status=pending, triageReason.via='user_correction', proposedPayload=<правка>)`. Куратор видит это в очереди и одобряет на detail-странице курации (Фаза C3) через существующий `POST /curation/items/:id/decide` (`approve` / `approve_with_edits`).

**Аудит кода (2026-06-04) показал пробел:** при `decide(approve / approve_with_edits)` для `resourceType ∈ {regulation, process, policy, decision}`:
- создаётся `CardVersion` (`appendCardVersion`, `trustTier='human'`) — **версия истории**;
- эмитится `curation.decision_recorded` → обучающий сэмпл;
- **НО канонический контент таблицы** (`regulations`/`process`/`policy`/`decisions`) и поле `currentVersionId` **НЕ обновляются**.

Это исторически корректно для **специалист-канонизации** (специалист 3.1 / 3.3 пишет таблицу ДО triage, а одобрение лишь «благословляет» уже записанный контент новой версией). Но для **user_correction-предложений** контент правки лежит только в `CurationItem.proposedPayload` — и при одобрении он **никуда не применяется**. Нет ни одного `@OnEvent`-слушателя, который бы переносил одобренный `proposedPayload` в каноническую таблицу (проверено грепом `decision_recorded` / `@OnEvent` по `backend/src`).

**Следствие сейчас (после E1):** предложение обычного сотрудника корректно ставится в очередь и видно куратору, но «одобрить» через стандартный `decide` **не применит текст** правки к карточке. Куратор как обходной путь применяет правку сам через «Исправить» (он owner/admin → `canApplyDirectly`, путь E1 apply работает полностью). Доминирующий путь Z (owner/admin правят сразу) закрыт; не закрыта только ветка «предложение рядового → авто-применение при одобрении».

## Почему это решение владельца (а не «просто доделать» в E1)

1. **Blast-radius.** Чистое закрытие требует тронуть `CurationService.decide()` — общий метод для ВСЕХ resourceType (card, entity, skill_trait, regulation, decision, …). Ошибка здесь ломает всю курацию, не только E.
2. **Семантика двойной записи.** `decide(approve_with_edits)` уже создаёт `CardVersion`. Наивный слушатель, который дополнительно вызовет «apply», породит **вторую** `CardVersion` той же правки. Нужна аккуратная развязка (применять контент+`currentVersionId`, но НЕ дублировать версию), иначе история засоряется.
3. **Не входило в acceptance E1.** Acceptance E1 для propose-ветки требует только «`CurationItem` с `proposedPayload` в очереди, карточка не меняется, без 403» — это **выполнено и зелёное**. Авто-применение при одобрении — отдельный продуктовый+архитектурный шаг.

## Цель
Чтобы одобрение куратором `user_correction`-предложения **применяло** правку к каноническому контенту карточки и снимало плашку «Не проверено человеком» — замкнуть петлю «предложение → одобрение → канон» для рядовых сотрудников.

## Фаза F1 — write-back одобренной user_correction-правки

**Что входит (предлагаемый дизайн, без circular-deps):**
- Слушатель `@OnEvent('curation.decision_recorded')` (отдельный provider, напр. `UserCorrectionApplierService` — в модуле, который МОЖЕТ импортировать `regulations`/`decisions` сервисы; они уже импортируют curation, поэтому обратный импорт делать НЕЛЬЗЯ → слушатель кладём в `regulations`/`decisions` модули, по одному на тип, ИЛИ один общий с прямым prisma-апдейтом). Решение по размещению — на этапе картографии.
- Гард: применять **только** если у item `triageReason.via === 'user_correction'` (в событие `triageReason` не входит → подгрузить `CurationItem` по `curationItemId`) И `decisionType ∈ {approve, approve_with_edits}`.
- Применить: для approve — `proposedPayload` из item; для approve_with_edits — финальный payload решения (`CurationDecision.payload`, т.к. куратор мог доредактировать). Записать каноническую таблицу (переиспользовать `regulationsService.applyCorrection` / `decisionsService` apply из E1) и указать `currentVersionId` на уже созданную `decide`-версию (НЕ плодить вторую `CardVersion`).
- Идемпотентность: повторный эмит/повторное применение — no-op (например, если `currentVersionId` уже указывает на версию этого decision).

**Что НЕ входит:** менять логику triage/канонизации специалистов; трогать non-card resourceType (entity/skill_trait и пр. — у них свой путь).

**Acceptance:**
- [ ] Одобрение (approve / approve_with_edits) `user_correction`-предложения переносит правку в каноническую таблицу и ставит `currentVersionId` на человеко-проверенную версию (плашка снимается).
- [ ] Специалист-канонизация и прочие resourceType **не затронуты** (нет двойных `CardVersion`, нет лишних апдейтов таблиц).
- [ ] Идемпотентность: повторное событие — no-op. Unit/e2e на оба случая + на гард `via!=='user_correction'`.
- [ ] typecheck/lint/тесты зелёные; ревью `strict-production-review-gate` по `decide`-пути.

**Файлы-ориентиры:** `curation.service.ts` (`decide`, `appendCardVersion`, эмит `curation.decision_recorded`), `regulations.service.ts` / `decisions.service.ts` (apply-методы из E1), `preference-dataset.service.ts` (образец `@OnEvent('curation.decision_recorded')`).

## Prod / second-brain
- Новых ENV/таблиц нет (всё на существующих `CurationItem`/`CardVersion`/канонических таблицах). Новый воркер/слушатель → `prod-deploy-log.md` Шаг 12 (smoke).
- second-brain: `02_architecture/knowledge-core.md` (замыкание петли курации→канон для user_correction).

## Итог
Не реализовано (фиксация пробела E1). Доминирующий путь (owner/admin «Исправить» → apply сразу) уже работает в E1. Эта фаза закрывает только авто-применение одобренного предложения рядового сотрудника и требует «погнали» владельца из-за blast-radius на ядро `decide()`.
