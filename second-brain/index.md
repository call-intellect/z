# SECOND BRAIN — Z (AI-встречи на LiveKit)

> Главный навигационный файл. Все разделы ведут отсюда.

## Карты верхнего уровня

- [[02_architecture/project-overview]] — что такое проект, MVP-границы, основной флоу

## Система

- [[00_system/SECOND_BRAIN_PROTOCOL]] — главный протокол
- [[00_system/SOURCE_OF_TRUTH]] — каким источникам верить
- [[00_system/STRUCTURE_RULES]] — правила файлов и папок
- [[00_system/LINKING_RULES]] — правила перелинковки
- [[00_system/INDEX_RULES]] — правила обновления этого файла
- [[00_system/TASK_WORKFLOW]] — процесс работы над задачей
- [[00_system/UPDATE_AFTER_CODE_CHANGE]] — что обновлять после изменений кода
- [[00_system/BOOTSTRAP_FROM_CODE]] — как первично заполнить second-brain

## Проекты

- [[01_projects/crossmark-integration]] — связь с Crossmark: только через API, развёртывание отдельное
- [[01_projects/meeting-types]] — 9 типов встреч MVP
- [[01_projects/ai-analysis-by-type]] — шаблоны AI-анализа по типу
- [[01_projects/roles-and-permissions]] — роли host/guest и их права
- [[01_projects/recording]] — запись встречи (общая + аудиодорожки) + retention (TTL по тарифу)
- [[01_projects/meeting-result-page]] — карточка результата: что показываем после встречи
- [[01_projects/capacity-and-infra]] — мощности, метрики, deployment-правила

## Архитектура

- [[02_architecture/project-overview]] — что такое проект и основной флоу
- [[02_architecture/tech-stack]] — стек технологий
- [[02_architecture/module-map]] — карта модулей и потоков данных
- [[02_architecture/data-model]] — сущности (Meeting, Participant, Recording, AI Result) и FSM статусов
- [[02_architecture/ai-integration]] — внутренние API компании: GigaAM Vox (ASR) + Claude Sonnet (LLM), `proxy.agent-lia.ru` для fallback

- [[02_architecture/code-pitfalls]] — копилка тех. фактов «не как кажется» (LiveKit, Egress, webhooks, ASR-биллинг)

## Решения / ADR
_пусто_

## Активные ТЗ
- `plans/architecture/2026-05-08-z-architecture.md` — целевая архитектура MVP (полное полотно: модули, FSM, контракты API, ENV, безопасность, decisions log)
- `plans/tz/2026-05-08-mvp-fullstack-tz.md` — основное ТЗ MVP по фазам 0–9 (frontend + backend + AI + admin + observability)
- `plans/tz/2026-05-06-infrastructure-deployment-tz.md` — фаза 0 (инфра): развёртывание серверов, LiveKit, Egress, БД, мониторинг, Selectel S3
- `plans/tz/2026-05-09-standalone-product.md` — Z как самостоятельный продукт: lead-style регистрация (имя+email → временный пароль письмом), кабинет с sidebar, журнал встреч в master-detail, дизайн-система на shadcn/ui

## Баги и инциденты (`03_bugs/`)
_пусто_

## Архив (`04_archive/`)
_пусто_

## Инфраструктура агента Claude Code

- `.claude/settings.json` — hooks (PreToolUse: блок `git push main/master`, `rm -rf /`, `DROP TABLE`; Stop: ворнинг про забытый second-brain после коммита в `backend/src` / `frontend/src` / `*.prisma`) + permissions deny для `.env` / секретов / ключей
- `.claude/skills/` — 12 скиллов (Crossmark-портированные + `bulletproof`, `skill-creator`, `frontend-design`); подробности и адаптации — в `plans/tz/2026-05-06-claude-code-infrastructure.md`
- `.mcp.json` — playwright MCP (UI-тесты)

---
_Обновлён: 2026-05-06_
