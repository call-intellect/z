#!/usr/bin/env python3
"""PreToolUse Bash guard for project Z.

Reads tool input from stdin (JSON), inspects the bash command, and exits with
code 2 (block) if the command matches dangerous patterns. Exit 0 = allow.

Replaces the previous jq-based hook (jq is not installed on this machine).
"""
import json
import re
import sys

try:
    sys.stderr.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0  # malformed input — fail open

    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    if not isinstance(cmd, str) or not cmd:
        return 0

    # Block git push to main/master without explicit override
    if re.search(r"git\s+push\b(?:\s+\S+)*\s+\b(main|master)\b", cmd):
        sys.stderr.write(
            "BLOCKED: git push to main/master is not allowed without explicit override\n"
        )
        return 2

    # Block rm -rf / and rm -rf /*
    if re.search(r"rm\s+-rf\s+/(?:\s|$|\*)", cmd):
        sys.stderr.write("BLOCKED: rm -rf on root\n")
        return 2

    # Block DROP TABLE in any shell command (psql, sqlcmd, etc.)
    if re.search(r"\bDROP\s+TABLE\b", cmd, re.IGNORECASE):
        sys.stderr.write(
            "BLOCKED: DROP TABLE detected — confirm explicitly via raw psql\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
