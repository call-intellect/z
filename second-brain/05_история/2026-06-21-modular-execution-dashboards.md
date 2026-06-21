---
title: Модульные дашборды исполнения — реестр виджетов + ролевые пресеты + canvas (Ф1–Ф5)
date: 2026-06-21
type: reflection
distilled: false
---

# Модульные дашборды исполнения — рефлексия 2026-06-21

## Что было поставлено

ТЗ `plans/tz/2026-06-21-modular-execution-dashboards.md` (реализован целиком). Перевести экраны `/dashboard` (День), `/week` (Неделя), `/month` (Месяц) с жёстко свёрстанных дашбордов на **модульную модель**: единый реестр виджетов + ролевые пресеты + canvas, рендерящий набор по паре `{role, rhythm}`. Три ритма День ⊂ Неделя ⊂ Месяц. Drill-down по людям и проваливание в исходный блок знаний.

## Как решал

Оркестрация суб-агентами по фазам:
- **Ф1 ∥ Ф2** параллельно — бэкенд (контроллер/сервис/DTO `ExecutionDashboardController` + `ExecutionDashboardService` + `execution-dashboard.dto.ts`, 5 GET) и фундамент фронтового реестра (`types.ts`/`widget-registry.ts`/`presets.ts`/`DashboardCanvas.tsx`/`use-dashboard-layout.ts`). Коммиты `9ee6d531`, `4e5d3748`.
- **Ф3** — `_kit.tsx` (общие примитивы) → виджеты M1–M10 ∥ интеграция экранов на канвас (`DirectorDashboardClient`/`WeekDesktopClient`/`MonthDesktopClient`). Коммит `1b9ed454`.
- **Ф4 + Ф5** — месячные виджеты (`WeeklyPlanFact`/`Trend`/`Achievements`/`Maturity`/`BusFactor`/`WeeklyDynamics`/`MonthRecap`) + проваливание блокеров (`OperationsDashboardService.fetchBlockers` → `sourceBlockId`; `BlockerSynthesisService.listChronicForTenant`/`ChronicBlockerDto` → `relatedBlockIds`). Коммит `f244ada6`.

Frontend-api `execution-dashboard.api.ts` + `dashboard-layout.api.ts`. Всё под `CookieAuthGuard+TenantGuard`+`canViewDirectorDashboard`, Zod-DTO + Swagger (тег `dashboard-execution`).

## Что вышло

- 18 виджетов в `WIDGET_REGISTRY`, 3 роли × 3 ритма в `DEFAULT_PRESETS`; member видит только `ideas`+`value`.
- 5 новых GET-эндпоинтов: `layout`, `goal-vector/by-person`, `issue-chains`, `load/by-person`, `operations/trend`.
- Схема БД не менялась (`sourceBlockId` — JSON-поле в `blockersJson`), миграции/ENV/seed/очередей/cron нет.
- Верификация: typecheck / lint / build / vitest зелёные. Прод-операции — только пересборка backend+frontend.

## Чему научился

- **Раскладка пресетов = Option B:** дефолты держим на фронте (`DEFAULT_PRESETS`), бэк-эндпоинт `layout` отдаёт только override из AdminSetting (`getDynamic`) **или** `null`. Так дефолтный набор виджетов не требует записи в БД и меняется в коде, а владелец может переопределить через крутилку.
- **Проваливание `?m=`/`?t=` уже было** в `ProvenanceDrawer` — добавлять не пришлось, нужно было лишь дотянуть `relatedBlockIds`/`sourceBlockId` до read-side.
- **`sourceBlockId` без точки population:** значение уже лежит в `blockersJson`, схема не трогается — это JSON-поле, не колонка. Важно не путать «новое поле в DTO» с «новой колонкой в БД» (Шаг 4 prod-deploy-log не затрагивается).
- **member без командных данных (Р6):** ролевой пресет — единственное место, где это решается; виджеты с `roles` без `member` просто не попадают в его canvas.
- **Нет двойного префикса:** в Z `@Controller('api/v1/dashboard')` указывает полный путь — `setGlobalPrefix` не используется, иначе получился бы `/api/v1/api/v1/...`.
