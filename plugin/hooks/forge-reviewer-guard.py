#!/usr/bin/env python3
"""PreToolUse hook for Bash: forge's review agents may not commit, push, rewrite branches or call GitHub.

Plugin agents ignore their own `hooks` frontmatter, so this runs for every Bash call in the session
and acts only when `agent_type` names one of forge's review agents. Everyone else passes untouched.
"""
import json
import re
import shlex
import sys

REVIEW_AGENTS = {"forge-logic-reviewer", "forge-data-reviewer", "forge-app-tester", "forge-diff-reviewer", "forge-validator"}
GIT_WRITES = {"commit", "push", "merge", "rebase", "cherry-pick", "revert", "am", "pull"}
# Git options that take a separate value, so the subcommand comes after it.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
OPERATORS = {"&&", "||", ";", "|", "&", "(", ")", ";;", "|&"}
FALLBACK = re.compile(r"(^|[\s;&|(`])(gh\s|git\s+(\S+\s+)*?(" + "|".join(sorted(GIT_WRITES)) + r")\b)")


def is_review_agent(agent_type):
    return (agent_type or "").rsplit(":", 1)[-1] in REVIEW_AGENTS


def segments(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    current = []
    for token in lexer:
        if token in OPERATORS or set(token) <= set("();&|"):
            if current:
                yield current
            current = []
        else:
            current.append(token.lstrip("`$"))
    if current:
        yield current


def program(words):
    """Drop leading VAR=value assignments and `env`/`command` wrappers."""
    while words and (re.fullmatch(r"[A-Za-z_]\w*=.*", words[0]) or words[0] in ("env", "command", "exec")):
        words = words[1:]
    return words


def git_subcommand(words):
    rest = words[1:]
    while rest and rest[0].startswith("-"):
        option = rest.pop(0)
        if option in GIT_VALUE_OPTIONS and rest:
            rest.pop(0)
    return rest[0] if rest else None


def blocked(command):
    try:
        parts = list(segments(command))
    except ValueError:
        return "could not be read by the review guard" if FALLBACK.search(command) else None
    for words in parts:
        words = program(words)
        if not words:
            continue
        name = words[0].rsplit("/", 1)[-1]
        if name == "gh":
            return "calls GitHub"
        if name == "git" and git_subcommand(words) in GIT_WRITES:
            return f"runs git {git_subcommand(words)}"
    return None


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": f"This command {reason}. Forge's reviewers only read, test and report; "
                                    "the orchestrator and the implementer own commits, pushes and GitHub.",
    }}))
    return 0


def main():
    try:
        payload = json.load(sys.stdin) or {}
    except ValueError:
        return 0
    if not is_review_agent(payload.get("agent_type")):
        return 0
    reason = blocked((payload.get("tool_input") or {}).get("command") or "")
    return deny(reason) if reason else 0


if __name__ == "__main__":
    sys.exit(main())
