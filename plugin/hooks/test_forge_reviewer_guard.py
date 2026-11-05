"""Run: python3 -I plugin/hooks/test_forge_reviewer_guard.py"""
import json
import os
import subprocess
import sys
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "forge-reviewer-guard.py")


def run(command, agent_type="imagineer:forge-logic-reviewer"):
    payload = {"tool_name": "Bash", "tool_input": {"command": command}}
    if agent_type is not None:
        payload["agent_type"] = agent_type
    return subprocess.run([sys.executable, "-I", SCRIPT], input=json.dumps(payload), text=True, capture_output=True)


def denied(command, agent_type="imagineer:forge-logic-reviewer"):
    result = run(command, agent_type)
    assert result.returncode == 0, result.stderr
    return bool(result.stdout) and json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"


class ForgeReviewerGuard(unittest.TestCase):
    def test_denies_writes(self):
        for command in [
            "git commit -m 'add test'", "git push origin HEAD", "git -C ../main commit -am fix",
            "git -c user.name=x commit -m y", "npm test && git push", "git merge main", "git rebase main",
            "git cherry-pick abc123", "git pull", "gh pr comment 4 --body hi", "gh api repos/o/r/issues -f title=x",
            "GIT_AUTHOR_NAME=x git commit -m y", "/usr/bin/git push", "echo ok; gh issue list",
            "(cd ../main && git commit -m x)", "x=$(git push)", "env FOO=1 git push",
        ]:
            with self.subTest(command=command):
                self.assertTrue(denied(command))

    def test_allows_reading_and_testing(self):
        for command in [
            "git checkout --detach 1a2b3c", "git diff main..1a2b3c", "git log --oneline -5", "git status",
            "npm test", "npx vitest run test/role-matrix.test.ts", 'grep -rn "git push" docs/',
            "echo 'git commit is not run here'", "git show HEAD:src/server.ts", "npx tsc --noEmit",
        ]:
            with self.subTest(command=command):
                self.assertFalse(denied(command))

    def test_every_review_agent_and_bare_names(self):
        for agent in ["forge-data-reviewer", "imagineer:forge-app-tester", "forge-diff-reviewer", "imagineer:forge-validator"]:
            with self.subTest(agent=agent):
                self.assertTrue(denied("git push", agent))

    def test_other_agents_untouched(self):
        for agent in [None, "imagineer:forge-implementer", "Explore", "general-purpose", "forge-scout"]:
            with self.subTest(agent=agent):
                self.assertFalse(denied("git push origin HEAD", agent))

    def test_unparsable_command(self):
        self.assertTrue(denied("git push 'unterminated"))
        self.assertFalse(denied("echo 'unterminated"))

    def test_bad_input_passes(self):
        result = subprocess.run([sys.executable, "-I", SCRIPT], input="not json", text=True, capture_output=True)
        self.assertEqual((result.returncode, result.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
