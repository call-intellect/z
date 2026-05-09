# Changelog

## [5.0.0] - 2026-03-21 — "Bulletproof"

### Renamed
- Skill renamed from "planning" to "Bulletproof"
- Repo: github.com/artemiimillier/bulletproof
- Slash command: /bulletproof

### Fixed (from v4 audit)
- Description field trimmed to 186 chars (Anthropic limit: 200)
- Code reviewer agent now reads spec before review
- Mode annotations added to Stages 2 and 3 (Read + Write constraints)
- Stage 3 explicitly reads both Spec and Research artifacts
- Inner/outer loop relationship explained
- Size S explicitly mapped to stage numbers
- Guard phrase added for implementation start
- Parallel session execution documented
- Optional PostToolUse auto-format hook added
- Optional PreToolUse secrets-blocking hook restored

### Added
- Intellectual Property notice in README
- All 53 elements verified across all versions (0 gaps)

## [4.0.0] - 2026-03-21

### Added
- Adaptive sizing (S/M/L) — not every task needs 12 stages
- Challenge Loop — "Is this actually the best solution?" at planning and audit stages
- False-positive-aware bug verification (3-step: find → prove → fix)
- Impact Analysis stage — regression, side effects, think ahead, compatibility
- Anti-rationalization hook — catches "code for code's sake" pattern
- Context management — 40% rule, fresh context between phases, handoff protocol
- Spec/PRD as separate artifact (WHAT/WHY ≠ HOW)
- Annotation Cycle (Boris Tane pattern) for plan review
- Code reviewer sub-agent with structured checklist
- Templates for research, spec, plan, handoff
- Model recommendations per stage (Opus/Sonnet/Haiku)
- Git discipline (feature branches, checkpoints, squash merge)
- Hooks: branch protection, anti-rationalization
- Progressive disclosure for codebase context

### Based on research from
- HumanLayer / Dex Horthy — Frequent Intentional Compaction, Dumb Zone
- Trail of Bits — Anti-rationalization hook, security hooks
- Addy Osmani — Spec-first, chunked iteration, TDD
- RIPER-5 / Tony Narlock — Phase separation
- Boris Tane / DataCamp — Annotation cycle
- Keywords Studios — Quality gates, strategic decomposition
- GitHub Spec Kit — Spec-driven development
- SWE-CI Benchmark (Alibaba) — 75% regression rate
- TDAD (arXiv) — Impact analysis reduces regressions 70%
- Anthropic Code Review — Multi-agent verification, disprove-first
- Spotify Engineering — Verification loops for predictability

## [1.0.0] - 2025 (original)

### Features
- 8-stage workflow
- TDD-first approach
- Deterministic gates (tsc, pytest, lint)
- Code review in fresh context
- Phased implementation
