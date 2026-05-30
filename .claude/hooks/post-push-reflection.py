#!/usr/bin/env python3
"""PostToolUse hook: remind to write reflection after git push.

CLAUDE.md (Триггер 1) requires: after each `git push`, update second-brain/,
write a reflection file in second-brain/05_история/, and push it as a separate
docs(second-brain): рефлексия — ... commit.

This hook fires after every Bash tool call, detects `git push` (not dry-run,
not the reflection-push itself), and emits a reminder on stderr that Claude
will see and act on.

Exit 0 always — never blocks; only reminds.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    sys.stderr.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0  # malformed input — silently no-op

    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    if not isinstance(cmd, str) or not cmd:
        return 0

    # Detect git push (not --dry-run, not push to specific helper-refspecs we want to ignore)
    if not re.search(r"\bgit\s+push\b", cmd):
        return 0
    if "--dry-run" in cmd:
        return 0

    proj = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        os.chdir(proj)
    except Exception:
        return 0

    if not Path(".git").exists():
        return 0

    # Look at the last commit on HEAD — if subject already mentions reflection,
    # the just-pushed commit was the reflection itself; do not nag again.
    try:
        subj = subprocess.check_output(
            ["git", "log", "-1", "--format=%s"], stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="replace").strip()
    except Exception:
        return 0

    if re.search(r"(рефлекс|reflection|second-brain.*history)", subj, re.IGNORECASE):
        return 0

    # Check whether a reflection file for today already exists in
    # second-brain/05_история/ — if yes, remind to commit+push it specifically;
    # otherwise remind to write one.
    today = subprocess.check_output(
        ["git", "log", "-1", "--format=%cs"], stderr=subprocess.DEVNULL
    ).decode("utf-8", errors="replace").strip() or ""

    history_dir = Path("second-brain/05_история")
    today_files = []
    if history_dir.exists() and today:
        prefix = today  # YYYY-MM-DD
        today_files = sorted(p.name for p in history_dir.glob(f"{prefix}-*.md"))

    msg = ["", "[POST-PUSH] CLAUDE.md триггер 1 — после git push:"]
    msg.append("  1. Обнови second-brain/ если изменилась бизнес-логика/архитектура")
    msg.append("     (см. таблицу производных заметок в CLAUDE.md)")
    if today_files:
        msg.append(f"  2. Рефлексия за {today} уже есть: {', '.join(today_files)}")
        msg.append("     → закоммить отдельным docs(second-brain): рефлексия — ... и запушь")
    else:
        msg.append(f"  2. Запиши рефлексию в second-brain/05_история/{today}-краткое-название.md")
        msg.append("     (что было поставлено / как решал / что вышло / чему научился)")
        msg.append("  3. Закоммить отдельным docs(second-brain): рефлексия — ... и запушь")
    msg.append("  4. Если затронуты БД/конфиг/admin-editable данные — выдай prod-инструкцию")
    msg.append("")
    msg.append("Если всё уже сделано в этой сессии — игнорируй.")
    sys.stderr.write("\n".join(msg) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
