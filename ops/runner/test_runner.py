import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner, remote = load("runner"), load("remote")


class RunnerTests(unittest.TestCase):
    def test_only_fixed_argv_tasks_are_allowed_without_shell_expansion(self):
        with tempfile.TemporaryDirectory() as state:
            tasks = {"echo": {"argv": ["/bin/echo", "$(id); touch /tmp/should-not-exist"]}}
            self.assertEqual(runner.execute("echo", tasks, state)["output"], "$(id); touch /tmp/should-not-exist\n")
            for task in ["echo;id", "unknown", ["echo"]]:
                with self.assertRaises(ValueError):
                    runner.execute(task, tasks, state)
            with self.assertRaises(ValueError):
                runner.execute("bad", {"bad": {"argv": ["echo", "x"]}}, state)

    def test_execution_deadline_and_output_limit(self):
        with tempfile.TemporaryDirectory() as state:
            out = runner.execute("sleep", {"sleep": {"argv": ["/bin/sleep", "10"]}}, state, timeout=1)
            self.assertEqual(out["exit"], -1)
            out = runner.execute("output", {"output": {"argv": ["/usr/bin/yes"]}}, state, timeout=1)
            self.assertLessEqual(len(out["output"].encode()), runner.MAX_OUTPUT)
            self.assertNotEqual(out["exit"], 0)

    def test_root_is_refused(self):
        with patch.object(runner.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "root"):
                runner.main()

    def test_ssh_requires_host_key_verification_and_rejects_options_as_host(self):
        with patch.dict(os.environ, {"RUNNER_SSH_HOST": "-oProxyCommand=evil"}):
            with self.assertRaises(ValueError):
                remote.call("health")
        result = subprocess.CompletedProcess([], 0, json.dumps({"exit": 0, "output": "ok"}), "")
        with patch.dict(os.environ, {"RUNNER_SSH_HOST": "optz-runner@example.com"}), patch.object(remote.subprocess, "run", return_value=result) as run:
            self.assertEqual(remote.call("health")["output"], "ok")
            args = run.call_args.args[0]
            self.assertIn("-oStrictHostKeyChecking=yes", args)
            self.assertIn("-oBatchMode=yes", args)
            self.assertNotIn("shell", run.call_args.kwargs)
            self.assertEqual(json.loads(run.call_args.kwargs["input"]), {"task": "health"})


if __name__ == "__main__":
    unittest.main()
