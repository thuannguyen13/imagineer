#!/usr/bin/env python3
"""Stop hook: when files changed, runs the project's fast checks once and sends Claude back with the errors if they fail.
The command is the first line of .claude/hooks/fast-checks.txt."""
import json
import os
import subprocess
import sys


def main():
    try:
        payload = json.load(sys.stdin) or {}
    except ValueError:
        payload = {}
    if payload.get("stop_hook_active"):
        return 0  # Already sent back once; let the session end rather than loop.
    project = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    try:
        with open(os.path.join(project, ".claude", "hooks", "fast-checks.txt")) as f:
            command = f.readline().strip()
    except FileNotFoundError:
        return 0
    status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=project)
    if not command or status.returncode != 0 or not status.stdout.strip():
        return 0
    result = subprocess.run(command, shell=True, capture_output=True, text=True, cwd=project)
    if result.returncode == 0:
        return 0
    tail = "\n".join((result.stdout + result.stderr).strip().splitlines()[-40:])
    print(f"The fast checks failed ({command}). Fix it before finishing; if the failure is not from this "
          f"session's changes, tell the user instead.\n{tail}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
