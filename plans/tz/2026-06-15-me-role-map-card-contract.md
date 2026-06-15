---
title: «Моя карта должности» на /me пуста — /me/profile не отдаёт summaryCache
type: tz
status: done (Вариант 1 — полная карта роли) — реализовано 2026-06-15, ветка feature/dialog-chat-assistant-chain, коммит 8f2a6f73. Владелец выбрал Вариант 1. Чинено через рабочий Role Map (RoleMapBuilderService), а не несуществующий summaryCache→blocks; попутно починен тот же баг на /roles/[id] overview.
date: 2026-06-15
owner: Сергей (sergrv80@gmail.com)
discovered_during: plans/tz/2026-06-15-cabinet-qa-bugfixes.md (Ф2 — должность в «Я»)
relates_to:
  - backend/src/modules/me/me.service.ts
  - frontend/app/(authenticated)/me/MeClient.tsx
  - frontend/src/api/structure.api.ts
---

# ТЗ-заглушка. Карта должности на /me не показывает содержимое

## Контекст (обнаружено при Ф2 QA-багфиксов)

При выравнивании контракта `GET /api/v1/me/profile` (Ф2) вскрылся **второй**
рассинхрон того же эндпоинта, не входивший в QA-отчёт 2026-06-15:

- **Backend** (`backend/src/modules/me/me.service.ts`, `MeProfileRoleProfileDto`)
  возвращает `roleProfile: { id, status, buildVersion, lastBuildAt } | null` —
  **без** `summaryCache`.
- **Frontend** (`MeClient.tsx` → `RoleProfileBlock`, стр. ~317) читает
  `profile.roleProfile.summaryCache.blocks`. Поскольку `summaryCache` в ответе
  нет → всегда `undefined` → блок «Моя карта должности» **всегда** показывает
  заглушку «Карта формируется…», даже когда профиль роли реально собран.
- Фронтовый тип `MyProfileApi.roleProfile` всё ещё указан как богатый
  `RoleProfileApi` (с `summaryCache`), то есть тип лжёт компилятору (рантайм-shape
  у́же). В Ф2 тип намеренно НЕ тронут, чтобы не расширять scope.

Данные есть: `RoleProfile.summaryCache` — `Json` на модели
(`schema.prisma:5239`), `{ responsibilities[], skills[], decision_patterns[],
common_pitfalls[], style_profile }`. Трансформация summaryCache → `blocks`
(`{key,title,items}[]`) уже реализована в `role-profiles` (см.
`backend/src/modules/role-profiles/services/role-profiles.service.ts`,
`role-profile.service.ts`) — её надо переиспользовать, не дублировать.

## Почему вынесено отдельно (а не в Ф2)

- QA-отчёт 2026-06-15 этот дефект **не выявил** (раздел «Я» отмечен как
  открывается без серверных ошибок; содержимое карты не проверялось).
- Включение карты роли на `/me` — **продуктовая поверхность** (что показывать,
  как считать `pending` «N материалов ждут анализа», нужен ли источник-клик):
  решение владельца (CLAUDE.md, правило про необратимое/продуктовое).
- Ф2 строго следует своему ТЗ (минимальные безопасные изменения).

## Предлагаемое решение (на согласование)

1. `me.service.ts`: добавить в select `roleProfile.summaryCache`, преобразовать в
   `blocks` переиспользуемой функцией из `role-profiles`-сервиса; расширить
   `MeProfileRoleProfileDto` полем `summaryCache: { blocks } | null` (+ при
   желании `pending`/`updatedAt`, если нужны UI).
2. `structure.api.ts`: сузить `MyProfileApi.roleProfile` до фактически
   возвращаемого shape (правда вместо `RoleProfileApi`), либо явно собрать
   совместимый подтип.
3. `MeClient.tsx`: `RoleProfileBlock` оставить как есть (он уже умеет рендерить
   `summaryCache.blocks`) — он заработает автоматически.
4. Тест: `me.service` отдаёт blocks; негатив — `summaryCache={}` → пустые блоки/
   заглушка.

## Acceptance

- Под аккаунтом с собранным профилем роли блок «Моя карта должности» на /me
  показывает реальные блоки (обязанности/навыки/…), а не вечную заглушку.
- typecheck/lint/build зелёные; точечный тест маппинга summaryCache → blocks.

## Итог

Не реализовано (ТЗ-заглушка). Ждёт решения владельца: показывать ли карту роли
на /me. Реализация — по явному «делаем карту должности на /me».
