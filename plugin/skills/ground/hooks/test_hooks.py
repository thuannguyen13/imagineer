"""Run: python3 -I plugin/skills/ground/hooks/test_hooks.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def run_hook(script, payload, args=(), cwd=None, project=None):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=project or tempfile.mkdtemp())
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, "-I", os.path.join(HERE, script), *args],
                          input=data, text=True, capture_output=True, env=env, cwd=cwd)


def asks(command, project=None):
    result = run_hook("block-destructive.py", {"tool_name": "Bash", "tool_input": {"command": command}}, project=project)
    assert result.returncode == 0, result.stderr
    return bool(result.stdout) and json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"] == "ask"


class BlockDestructive(unittest.TestCase):
    def test_asks(self):
        for command in [
            "git push --force origin main", "git push -f", "git push --force-with-lease", "git push origin +main",
            "git push origin --delete feature", "git reset --hard HEAD~1", "git clean -fdx",
            'psql -c "DROP TABLE users"', "psql -c 'alter table users drop column email'",
            "echo 'truncate table expenses;' | psql", 'psql -c "DELETE FROM users;"', "psql -c 'delete from public.users'",
            "dropdb app", "npx prisma migrate reset", "supabase db reset",
            "git push origin :main", "git push -uf origin main", "git branch -D feature", "git checkout -- .",
            "rm -rf data", "rm -fr node_modules uploads",
        ]:
            with self.subTest(command=command):
                self.assertTrue(asks(command))

    def test_allows(self):
        for command in [
            "git push origin feature", "git push origin feature && rm -f build.log", "npm test",
            'psql -c "DELETE FROM users WHERE id = 1"', "psql <<'SQL'\nDELETE FROM users\nWHERE id = 1;\nSQL",
            "git commit -m 'drop unused helper'", "git reset --soft HEAD~1",
            'git commit -m "Truncate long titles"', 'grep -rn "DROP TABLE" migrations/', 'git log --grep="drop column"',
            "rm -rf node_modules dist", "git checkout -- src/app.ts", "git branch -d merged",
        ]:
            with self.subTest(command=command):
                self.assertFalse(asks(command))

    def test_bad_input_asks_instead_of_crashing(self):
        self.assertIn('"ask"', run_hook("block-destructive.py", "not json").stdout)
        self.assertEqual(run_hook("block-destructive.py", {"tool_input": None}).stdout, "")

    def test_production_patterns(self):
        project = tempfile.mkdtemp()
        os.makedirs(os.path.join(project, ".claude", "hooks"))
        with open(os.path.join(project, ".claude", "hooks", "production-patterns.txt"), "w") as f:
            f.write("# production markers\nAPP_ENV=prod\n\\bvercel\\b.*--prod\nunbalanced(\n")
        self.assertTrue(asks("APP_ENV=prod npm start", project))
        self.assertTrue(asks("vercel deploy --prod", project))
        self.assertTrue(asks("echo unbalanced(", project))
        self.assertFalse(asks("APP_ENV=dev npm start", project))


class CheckBeforeStop(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        with open(os.path.join(self.repo, ".git", "info", "exclude"), "a") as f:
            f.write(".claude/\n")

    def stop(self, check, active=False):
        os.makedirs(os.path.join(self.repo, ".claude", "hooks"), exist_ok=True)
        with open(os.path.join(self.repo, ".claude", "hooks", "fast-checks.txt"), "w") as f:
            f.write(check + "\n")
        other = tempfile.mkdtemp()  # the session may be in another folder
        return run_hook("check-before-stop.py", {"stop_hook_active": active}, cwd=other, project=self.repo).returncode

    def test_no_changes_lets_it_finish(self):
        open(os.path.join(self.repo, "a.txt"), "w").close()
        subprocess.run(["git", "-C", self.repo, "add", "-A"], check=True)
        subprocess.run(["git", "-C", self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], check=True)
        self.assertEqual(self.stop("false"), 0)

    def test_changed_files_run_the_check(self):
        open(os.path.join(self.repo, "new.txt"), "w").close()  # untracked files count
        self.assertEqual(self.stop("true"), 0)
        self.assertEqual(self.stop("false"), 2)
        self.assertEqual(self.stop("true && false"), 2)  # compound checks stay one command

    def test_sent_back_once_only(self):
        open(os.path.join(self.repo, "new.txt"), "w").close()
        self.assertEqual(self.stop("false", active=True), 0)


if __name__ == "__main__":
    unittest.main()
