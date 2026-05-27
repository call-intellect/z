---
title: Документация RBAC — карта системы доступов
date: 2026-05-27
distilled: false
---

# 2026-05-27 — Документация RBAC

## Что было поставлено

Пользователь попросил разобраться в системе уровней доступа: какие роли есть, как они распределяются, как назначаются, к чему есть доступ — и зафиксировать это в базу знаний, чтобы не разбираться заново каждый раз.

## Как решал

1. Прочитал `second-brain/index.md` чтобы понять структуру.
2. Прочитал `second-brain/01_projects/orgs-and-rbac.md` — краткое описание модели.
3. Прочитал `second-brain/02_architecture/module-map.md` для контекста.
4. Прочитал `backend/src/modules/rbac/policies/policy.csv` — все ~900 строк политик.
5. Прочитал `backend/src/modules/rbac/rbac.service.ts` — реализация.
6. Структурировал найденное в новый файл `second-brain/01_projects/rbac-access-control.md` (детальная карта).
7. Обновил `second-brain/index.md` ссылкой на новую заметку.
8. Коммит `c9f9d79`, push в origin/dev.

## Что вышло

- Создан новый файл `second-brain/01_projects/rbac-access-control.md` (454 строки) с полной картой:
  - 5 ролей (super_admin / owner / admin / manager / coo)
  - Модель visibilityMode (open/strict)
  - 60+ ResourceType'ов
  - Формат policy.csv (Casbin-стиль)
  - Специальные логики (person.erase, clone-access, knowledge-core shared)
  - Реализация RbacService (check + evaluate + cache)
- Обновлён `second-brain/index.md` с ссылкой на новую заметку.
- Коммит `c9f9d79` запушен в origin/dev.

## Чему научился

1. **`orgs-and-rbac.md` существовал и описывал базу**, но не давал полной картины ResourceType'ов и тонкостей (manager open vs strict, knowledge-core shared, clone-access v1 vs v2). Полная карта была размазана между policy.csv и RbacService — для будущей навигации это надо держать в одном месте.
2. **Роль `coo` появилась в β-8** (2026-05-25) и даёт особый паттерн read-only-доступа: видит всё для оперативного контроля, пишет только свой check-in. Это новая модель доступа в Z — не админ, но широкий read.
3. **Knowledge-core (block/entity/theme) НЕ имеет ownerId** — manager strict читает всех, потому что иначе разваливается поиск и графы. Принципиальный паттерн.
4. **policy.csv растёт по мере новых sub-ТЗ** — каждый новый ресурс добавляет ~10-15 строк правил. Стоит ли вытаскивать в отдельный UI/admin для управления — пока ОК так, но это потенциальный bottleneck.

## Что осталось

- Prod-операций нет (только документация в second-brain).
- При следующих изменениях RBAC (новые ResourceType / роли) — синхронизировать `rbac-access-control.md`.
