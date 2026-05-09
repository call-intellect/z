---
type: tz
status: done
feature: claude-code-infrastructure
date: 2026-05-06
---

# ТЗ: Установка Claude Code инфраструктуры в Z

> Источник: `setup-claude-tools.md` в корне проекта (выжимка из Crossmark).

## Цель

Перенести в репозиторий Z набор `.claude/` (skills + hooks + permissions) и `.mcp.json`, идентичный по составу Crossmark, но адаптированный под стек/домен Z.

## Scope

**Входит:**
- `.claude/settings.json` — hooks (PreToolUse + Stop) + permissions
- `.mcp.json` — playwright
- `.claude/skills/` — 12 скиллов:
  - универсальные (без правок): `core-engineering-standards`, `strict-production-review-gate`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `safe-seed-rules`
  - переименованный: `z-ai-agent-rules` (бывший crossmark-ai-agent-rules)
  - переписанные под Z: `domain-business-context`, `project-architecture-router`
  - внешние: `bulletproof`, `skill-creator`, `frontend-design`

**Не входит:**
- user-global конфиг (`~/.claude/settings.json`) — он уже у разработчика
- адаптация скиллов после установки (она будет идти по мере работы над фичами)

## Технические изменения

### Backend / Frontend
Кода ещё нет. Скиллы и хуки ставятся «впрок» — сработают, когда появится `backend/src/`, `frontend/src/`, `prisma/`.

### Файловая система
- `c:/work/z/.claude/settings.json`
- `c:/work/z/.claude/skills/<имя>/SKILL.md` × 12
- `c:/work/z/.mcp.json`

### Адаптации под Z (отличия от Crossmark)

| Что | Изменение |
|---|---|
| Package manager | `bun` (как и в Crossmark) |
| Stop/command хук | пути backend/src, frontend/src, prisma/ — поставить впрок; second-brain/ путь корректный |
| `crossmark-ai-agent-rules` | переименовать → `z-ai-agent-rules`, заменить «Crossmark» → «Z» |
| `domain-business-context` | переписать целиком: AI-видеовстречи на LiveKit, 9 типов, host/guest, AI-отчёт по типу |
| `project-architecture-router` | переписать: домены Z (`meetings`, `recording`, `ai-pipeline`, `livekit`, `auth-guest`, `billing`), путь к second-brain без переименования |
| `core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `safe-seed-rules` | минимальная замена «Crossmark» → «Z» в шапке |
| `strict-production-review-gate` | блок «Специфика Crossmark» → «Специфика Z» (LiveKit-токены только на бэке, гость без секретов, аудио отдельными дорожками) |

## Критерии готовности (DoD)

- [ ] `.claude/settings.json` создан, валиден
- [ ] `.mcp.json` создан
- [ ] 12 скиллов в `.claude/skills/`, каждый с frontmatter `name` + `description`
- [ ] `bulletproof`, `skill-creator`, `frontend-design` подтянуты из git
- [ ] Список скиллов появляется в system-reminder при следующем старте сессии
- [ ] `second-brain/index.md` упоминает `.claude/skills/` (если нужно — добавить раздел «Инфраструктура агента»)

## Риски и ограничения

- **bulletproof:** официального публичного репо у автора может не быть → если git clone не получится, ставим заглушку и фиксируем риск.
- **Anthropic skills:** репо `https://github.com/anthropics/skills` может содержать обновления — берём `main` HEAD.
- **Stop/command хук без backend/src:** при коммитах в `second-brain/` хук молча проходит — это ОК, он triggerится только когда есть код.

## Фазы реализации

- [x] Фаза 1 — `.claude/settings.json` + `.mcp.json`
- [x] Фаза 2 — Crossmark-skills скопированы (адаптированы под стек Z, минимальная замена `Crossmark` → `Z`): 5 универсальных (`core-engineering-standards`, `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `safe-seed-rules`) + `strict-production-review-gate` с блоком «Специфика Z» + `z-ai-agent-rules` (переименован)
- [x] Фаза 3 — `domain-business-context` и `project-architecture-router` написаны под Z (видеовстречи, 9 типов, host/guest, домены `meetings`/`livekit-bridge`/`ai-pipeline`/`recording`/`auth-guest`)
- [x] Фаза 4 — внешние скиллы из git: `skill-creator` + `frontend-design` из `github.com/anthropics/skills`; `bulletproof` из `github.com/artemiimillier/bulletproof`
- [x] Фаза 5 — `second-brain/index.md` обновлён, добавлен раздел «Инфраструктура агента Claude Code»

## Итог

Реализовано целиком. В `c:/work/z/.claude/skills/` 12 папок, каждая с валидным SKILL.md (frontmatter `name` + `description`):

1. `bulletproof` (внешний, MIT)
2. `core-engineering-standards`
3. `domain-business-context`
4. `frontend-design` (Anthropic)
5. `frontend-rules`
6. `nestjs-rules`
7. `prisma-db-push-rules`
8. `project-architecture-router`
9. `safe-seed-rules`
10. `skill-creator` (Anthropic)
11. `strict-production-review-gate`
12. `z-ai-agent-rules`

Также созданы:
- `c:/work/z/.claude/settings.json` — hooks + permissions
- `c:/work/z/.mcp.json` — playwright MCP

**Что осталось:**
- Скиллы **поставлены впрок** под стек Z. Когда появится `backend/src/` — Stop-хук начнёт работать; пока он молча не triggerится.
- При запуске сессии Claude Code в `c:/work/z` — через `/mcp` нужно убедиться, что playwright поднимается.
- Список 12 скиллов появится в system-reminder при следующем старте сессии.
