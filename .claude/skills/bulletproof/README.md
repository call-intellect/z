# 🛡️ Bulletproof

[![GitHub stars](https://img.shields.io/github/stars/artemiimillier/bulletproof?style=for-the-badge&logo=github)](https://github.com/artemiimillier/bulletproof/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)](CONTRIBUTING.md)
[![Last Commit](https://img.shields.io/github/last-commit/artemiimillier/bulletproof?style=for-the-badge)](https://github.com/artemiimillier/bulletproof/commits/main)
[![Claude Code](https://img.shields.io/badge/Claude_Code-compatible-blue?style=for-the-badge)](https://claude.com/claude-code)
[![Cursor](https://img.shields.io/badge/Cursor-compatible-blue?style=for-the-badge)](https://cursor.com)

**A complete development methodology for AI agents. From idea to production.**

> AI agents without a system are chaotic code generators. They start coding before they understand the task, grab the first solution instead of the best one, "find bugs" that aren't bugs, and say "done" when half the work isn't finished. Bulletproof turns that chaos into discipline.

**Author:** Artemiy Miller · [GitHub](https://github.com/artemiimillier) · [Telegram](https://t.me/artemiymiller) · [Channel](https://t.me/+0jZamDvGOeZjOWE1) · [Email](mailto:who.ismillerr@gmail.com)

---

## The Problem

You describe a feature. The AI writes code. Looks great. Then:

- It broke something that was working fine
- It "fixed" bugs that didn't exist and created real ones
- It refactored code nobody asked it to touch
- It said "done" when half the acceptance criteria aren't met
- It picked the first solution that came to mind, not the best one
- Next morning you realize it ignored the entire architecture of your project

**75% of AI agents introduce regressions into working code** (SWE-CI benchmark, Alibaba 2025). This isn't an AI problem. It's a process problem.

---

## How Bulletproof Fixes This

Bulletproof is a 12-stage workflow. Every stage exists because without it, something specific breaks. Not every task goes through all 12 - a bug fix runs through 6, a feature through 10, an architecture change through all 12.

Here's what happens at each one:

---

### 🔍 Stage 1: Deep Research

**The pain:** AI jumps straight into coding. Doesn't study the codebase, doesn't look for existing solutions, doesn't understand context.

**What Bulletproof does:** AI launches parallel research agents. Each one digs into a different area - project structure, patterns, dependencies, tests. At the same time, it searches the web: who's already solved this? What libraries exist? What's the proven best practice?

**The key thing:** The output isn't a list of options. It's a **concrete recommendation**: "the best approach is X, because Y." The AI has to make a decision and defend it, not dump the choice on you.

---

### 📋 Stage 2: Spec

**The pain:** AI starts writing code without defining what exactly needs to be done. No criteria for "done." It ends up building the wrong thing, or building too much.

**What Bulletproof does:** Creates a specification: WHAT we're building and WHY. Not how - just what. With clear acceptance criteria - an objective measure of "done" that the AI can't argue with later.

**The key thing:** The spec is a **contract**. When the AI checks its own work at Stage 5, it checks against this contract, not against its gut feeling of "seems about right."

---

### 🧠 Stage 3: Plan + Challenge Loop

**The pain:** AI grabs the first solution that pops into its head. Doesn't consider alternatives, doesn't think about consequences.

**What Bulletproof does:** AI creates a plan. But before it can start coding, it has to pass the Challenge Loop - answer 3 questions:

1. **Does this actually solve the problem?** Compare every item in the plan against acceptance criteria from the spec. If anything isn't covered - the plan is incomplete.
2. **Is this the best solution?** Find 2-3 alternative approaches, compare pros and cons, and justify why the chosen one is better than all of them.
3. **Is there any "code for code's sake"?** Every change must tie directly to solving the problem. Drive-by refactoring = separate task, not part of this one.

**The key thing:** AI can't start coding until it has **proven** that its plan is the best option available. Not "I think so" - "here are 3 options, here's the comparison, here's why this one wins."

---

### ⚡ Stage 4: Implementation

**The pain:** AI writes code in one big chunk, context fills up, quality drops. No tests, no iterations.

**What Bulletproof does:** Implementation is split into phases. Each phase runs in a fresh context window (so the AI doesn't get dumber as it goes). Order: tests first (TDD), then code. Phases with no dependencies can run in parallel across separate terminals.

**The key thing:** **The 40% rule.** AI output quality degrades when context fills beyond 40%. Bulletproof runs `/clear` between stages and passes context through handoff documents. The AI always works in its "smart zone."

---

### ✅ Stage 5: Self-Audit

**The pain:** AI says "done" - but half the criteria aren't met. Or it did extra stuff nobody asked for.

**What Bulletproof does:** AI opens the spec and walks through every acceptance criterion: implemented? Where exactly in the code? Anything in there that wasn't part of the task?

**The key thing:** It doesn't check based on vibes. It checks against **the contract**. Every criterion - yes or no. If no - go back and finish.

---

### 🔬 Stage 6: Verification

**The pain:** AI "finds bugs" that aren't bugs. Fixes things that aren't broken. Makes "improvements" that create real problems.

**What Bulletproof does:** Three-step check. Step 1 - find errors (logic, security, performance). Step 2 - **prove every bug is real**. Can you reproduce it? No? Then it's not a bug, don't touch it. Step 3 - logic and efficiency review.

**The key thing:** The rule is **"don't fix code for aesthetics or just in case."** Every fix without proof is a risk of introducing a new bug. Early AI code reviewers flagged 9 false positives for every 1 real bug (Anthropic). This stage cuts out 90% of wasted work.

---

### 💥 Stage 7: Impact Analysis

**The pain:** The code works. But it broke something somewhere else. You find out a week later.

**What Bulletproof does:** Mandatory check before merge: (1) What modules depend on the changed files? Run ALL project tests, not just the current phase. (2) Did any contracts change - APIs, types, interfaces? Are all consumers updated? (3) What could go wrong in a month? With zero data? With a million records? With concurrent requests? (4) Backward compatibility? Migrations needed?

**The key thing:** **75% of AI agents break working code** - precisely because this stage doesn't exist. Dependency graph analysis cuts regressions by 70% (TDAD/arXiv).

---

### 🔗 Stage 8: Integration Check

All phases done - full test suite across the entire project. Audit: is everything from the spec actually implemented?

---

### 👁️ Stage 9: Code Review

**The pain:** AI reviews its own code and thinks it's great.

**What Bulletproof does:** New session. Fresh context. A separate agent that has **never seen** the implementation. Checks edge cases, race conditions, security, performance.

**The key thing:** AI reviewing AI, but without the implementer's bias. For critical code - you still need a human, and Bulletproof says so explicitly.

---

### 🔒 Stage 10: Security Scan

Automated vulnerability scanning. AI-generated code has 2-3x more security issues than human-written code. This catches them.

---

### 🔧 Stage 11: Fixes + Re-verification

Found issues? Fix only proven bugs (Stage 6 rule still applies). After fixes - run impact analysis again. Fixes break code more often than original development does.

---

### 🚀 Stage 12: Deploy

Archive the plan. Squash merge. Deploy - only when you explicitly say so.

---

## Plus: Anti-Rationalization Hook

This one lives outside the stages. It's a Stop hook that fires **every time** the AI tries to wrap up. It checks:

- Is the AI rationalizing incomplete work? ("pre-existing issue", "out of scope", "I'll note this for a follow-up")
- Listing problems without actually fixing them?
- Skipping failed tests with excuses?
- Making changes unrelated to the task?
- Claiming "done" without running verification?

If yes - **blocks completion** and sends the AI back to finish.

---

## Adaptive Sizing

Not every task needs all 12 stages:

| Size | What | Stages |
|------|------|--------|
| **S** - bug fix, 1-2 files | Lightweight | Research → Build → Self-Audit → Verify → Impact → Gates |
| **M** - feature, 3-10 files | Standard | Stages 1-10 |
| **L** - architecture, 10+ files | Full pipeline | All 12 stages |

---

## Why This Works

Not theory. Every mechanism is backed by research:

| Mechanism | Source |
|-----------|--------|
| 40% context rule | HumanLayer |
| Challenge Loop (justify decisions) | Addy Osmani, spec-first workflow |
| False-positive filter | Anthropic Code Review |
| Impact Analysis (dependency graphs) | SWE-CI (Alibaba), TDAD/arXiv |
| Anti-rationalization | Trail of Bits |
| Phase separation | RIPER-5, Spotify Engineering |

---

## Who This Is For

- You're building real products with AI, not throwaway prototypes
- You're tired of code that works on demo but breaks in production
- You need a system that scales - from a one-line fix to a new microservice

---

## Install (30 seconds)

```bash
# Into your project
mkdir -p .claude/skills && git clone https://github.com/artemiimillier/bulletproof.git .claude/skills/bulletproof

# Global (all projects)
mkdir -p ~/.claude/skills && git clone https://github.com/artemiimillier/bulletproof.git ~/.claude/skills/bulletproof

# For teams
git submodule add https://github.com/artemiimillier/bulletproof.git .claude/skills/bulletproof
```

Open Claude Code → type `/bulletproof` → done.

Or just describe your task - Claude picks up Bulletproof automatically when it's relevant.

---

## Compatibility

Claude Code · Codex · Cursor · Gemini CLI · Windsurf · OpenCode - any tool that supports the Agent Skills standard.

---

## What's Inside

```
bulletproof/
├── SKILL.md              # The full 12-stage workflow
├── templates/            # Artifact templates (research, spec, plan, handoff)
├── agents/               # Code review sub-agent
├── examples/             # Use cases
├── CONTRIBUTING.md
└── LICENSE               # MIT
```

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT

*[Artemiy Miller](https://github.com/artemiimillier) · [Telegram](https://t.me/artemiymiller) · [Channel](https://t.me/+0jZamDvGOeZjOWE1) · [Email](mailto:who.ismillerr@gmail.com)*
