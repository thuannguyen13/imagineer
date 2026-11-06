#!/usr/bin/env python3
"""PreToolUse hook for Bash: asks the user before a command that destroys data or shared history."""
import json
import os
import re
import shlex
import sys

GIT_RULES = [
    (r"^git\s+push\b.*(\s--force(-with-lease)?\b|\s-[a-z]*f[a-z]*\b|\s\+\S|\s:\S|\s--delete\b)", "rewrites or deletes shared history"),
    (r"^git\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-D|(checkout|restore)\s+(--\s+)?\.(\s|$))", "discards work"),
]
DATA_RULES = [
    (r"\bdrop\s+(table|database|schema|column)\b|\btruncate\s+(table\s+)?[\w.\"]", "drops or empties data"),
    (r"\bdelete\s+from\s+[\w.\"]+\s*(;|\"|'|$)", "deletes every row (DELETE without WHERE)"),
    (r"\bdropdb\b|\bmigrate\s+reset\b|\bdb\s+reset\b", "resets a database"),
]
# Commands that only mention destructive words in their text.
QUOTING = re.compile(r"^(git\s+(commit|log|tag)|grep|rg)\b")
REBUILDABLE = {"node_modules", "dist", "build", ".next", ".cache", "coverage", "tmp", "out", "target", "__pycache__"}


def removes_data(segment):
    try:
        words = shlex.split(segment)
    except ValueError:
        return True
    if not words or words[0] != "rm" or not any(re.fullmatch(r"-\w*(rf|fr)\w*", w) for w in words[1:]):
        return False
    targets = [w for w in words[1:] if not w.startswith("-")]
    return any(os.path.basename(t.rstrip("/")) not in REBUILDABLE for t in targets)


def production_rules():
    path = os.path.join(os.environ.get("CLAUDE_PROJECT_DIR", "."), ".claude", "hooks", "production-patterns.txt")
    try:
        with open(path) as f:
            lines = [line.strip() for line in f]
    except FileNotFoundError:
        return []
    rules = []
    for line in lines:
        if not line or line.startswith("#"):
            continue
        try:
            re.compile(line)
        except re.error:
            line = re.escape(line)
        rules.append((line, "touches production"))
    return rules


def ask(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": f"This command {reason}. Approve only if you meant it.",
    }}))
    return 0


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return ask("could not be read by the safety check")
    command = ((payload or {}).get("tool_input") or {}).get("command") or ""
    for pattern, reason in production_rules():
        if re.search(pattern, command, re.IGNORECASE):
            return ask(reason)
    # Commit messages and searches only mention destructive words; leave them out.
    kept = [seg.strip() for seg in re.split(r"&&|\|\||[;\n]", command) if not QUOTING.match(seg.strip())]
    for pattern, reason in DATA_RULES:
        if re.search(pattern, "\n".join(kept), re.IGNORECASE):
            return ask(reason)
    for segment in (part.strip() for seg in kept for part in seg.split("|")):
        if removes_data(segment):
            return ask("deletes files that cannot be rebuilt")
        for pattern, reason in GIT_RULES:
            if re.search(pattern, segment):
                return ask(reason)
    return 0


if __name__ == "__main__":
    sys.exit(main())
