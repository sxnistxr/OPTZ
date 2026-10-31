import argparse
import base64
from contextlib import ExitStack, redirect_stdout
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


controller = load("controller", HERE / "controller.py")
entry = load("entry", HERE / "ssh-entry.py")
migration = load("migration", HERE.parent / "migrate-autodeploy.py")
SHA, OTHER = "a" * 40, "b" * 40
CONFIG = {"repository": "example/OPTZ", "branch": "main", "engine_port": 3000}


def successful_run():
    return {"id": 123, "head_sha": SHA, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success",
            "path": ".github/workflows/ci.yml", "repository": {"full_name": "example/OPTZ"}, "head_repository": {"full_name": "example/OPTZ"}}


class DeploymentTests(unittest.TestCase):
    def test_forced_command_has_no_shell_and_rejects_injection(self):
        self.assertEqual(entry.command(f"deploy {SHA} 123"), ["/usr/bin/sudo", "-n", "/usr/local/lib/optz-deploy/controller.py", SHA, "123"])
        for value in ["", "bash", f"deploy {SHA} 123;id", f"deploy {SHA} 123\nid", f"deploy {SHA} 0", f"deploy {'a'*7} 123", f"deploy {SHA} --help", f"deploy {SHA} 123 "]:
            with self.assertRaises(ValueError):
                entry.command(value)
        with self.assertRaises(ValueError):
            controller.validate_request("--config=evil", "123")

    def test_ci_provenance_checks_all_fields(self):
        controller.validate_run(CONFIG, successful_run(), SHA, "123")
        for field, value in [("id", 124), ("head_sha", OTHER), ("head_branch", "feature"), ("event", "pull_request"),
                             ("status", "in_progress"), ("conclusion", "failure"), ("path", ".github/workflows/other.yml"),
                             ("repository", {"full_name": "evil/repo"}), ("head_repository", {"full_name": "fork/OPTZ"})]:
            record = successful_run(); record[field] = value
            with self.assertRaises(ValueError, msg=field):
                controller.validate_run(CONFIG, record, SHA, "123")

    def test_artifact_links_and_special_files_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "release"; root.mkdir()
            (root / "a").write_text("ok"); (root / "link").symlink_to("a")
            controller.validate_tree(root)
            for target in ["/etc/passwd", "../outside", "../../etc/shadow"]:
                (root / "link").unlink(); (root / "link").symlink_to(target)
                with self.assertRaises(ValueError):
                    controller.validate_tree(root)
            (root / "link").unlink(); os.mkfifo(root / "pipe")
            with self.assertRaises(ValueError):
                controller.validate_tree(root)

    def test_artifact_root_and_parent_symlinks_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "real").mkdir(); (root / "real/release").mkdir()
            (root / "link").symlink_to("real")
            for path in [root / "link", root / "link/release"]:
                with self.assertRaises(ValueError): controller.validate_tree(path)

    def test_failed_health_check_restores_previous_release(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory); releases = root / "releases"; releases.mkdir()
            old = releases / "old"; new = releases / ("ci-" + SHA); old.mkdir(); new.mkdir()
            current = root / "current"; current.symlink_to(old)
            stack.enter_context(patch.object(controller, "CURRENT", current))
            stack.enter_context(patch.object(controller, "RELEASES", releases))
            calls = stack.enter_context(patch.object(controller, "run"))
            stack.enter_context(patch.object(controller, "healthy", side_effect=[False] * 30 + [True]))
            stack.enter_context(patch.object(controller.time, "sleep"))
            with self.assertRaisesRegex(ValueError, "health"):
                controller.promote(new, 3000)
            self.assertEqual(current.resolve(), old)
            self.assertEqual(calls.call_count, 2)
            self.assertTrue(all("optz.service" in c.args[0] and "optz-web.service" in c.args[0] for c in calls.call_args_list))

    def test_failed_or_superseded_ci_cannot_start_a_build(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory); config = root / "config.json"; config.write_text(json.dumps(CONFIG))
            stack.enter_context(patch.object(controller, "CONFIG", config))
            stack.enter_context(patch.object(controller, "STATE", root))
            stack.enter_context(patch.object(controller.os, "geteuid", return_value=0))
            stack.enter_context(patch.object(controller.os, "umask"))
            stack.enter_context(patch.object(controller.sys, "argv", ["controller", SHA, "123"]))
            record = successful_run(); record["conclusion"] = "failure"
            api = stack.enter_context(patch.object(controller, "github_run", return_value=record))
            prepare = stack.enter_context(patch.object(controller, "prepare_source", return_value=False))
            build = stack.enter_context(patch.object(controller, "build_release"))
            with self.assertRaises(ValueError): controller.main()
            prepare.assert_not_called(); build.assert_not_called()
            api.return_value = successful_run()
            controller.main()
            build.assert_not_called()

    def test_build_is_sandboxed_and_never_installs_units_from_artifact(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory); build = root / "build"; releases = root / "releases"; releases.mkdir()
            source = build / "work/release"; (source / "bin").mkdir(parents=True)
            (source / "bin/twelve-iouring").write_bytes(b"\x7fELFtest")
            (source / "bin/twelve-iouring").chmod(0o6755)
            (source / "web/portfolio/dist").mkdir(parents=True)
            (source / "web/portfolio/dist/manifest.json").write_text('{}')
            stack.enter_context(patch.object(controller, "BUILD", build))
            stack.enter_context(patch.object(controller, "RELEASES", releases))
            execute = stack.enter_context(patch.object(controller, "run"))
            result = controller.build_release(SHA)
            args = execute.call_args.args[0]
            self.assertIn("--uid=optz-build", args)
            self.assertIn("--property=NoNewPrivileges=yes", args)
            self.assertIn("--property=ProtectSystem=strict", args)
            self.assertIn("--property=KillMode=control-group", args)
            self.assertNotIn("daemon-reload", args)
            self.assertEqual((result / "REVISION").read_text().strip(), SHA)
            self.assertFalse((result / "bin/twelve-iouring").stat().st_mode & 0o6022)
            # A rerun reuses a completed immutable build rather than failing or overwriting it.
            self.assertEqual(controller.build_release(SHA), result)
            self.assertEqual(execute.call_count, 1)


class ReleaseLayoutTests(unittest.TestCase):
    def test_packaging_preserves_service_paths_and_auth_workspace_links(self):
        # Execute the real packaging stage without compiling or touching production paths.
        packaging = (HERE / "build.sh").read_text().split("# Keep workspace links", 1)[1]
        packaging = "# Keep workspace links" + packaging
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, work = root / "src", root / "work"
            manifest = json.loads((HERE.parent.parent / "portfolio/content/docs/index.json").read_text())
            doc_sources = [page["file"] for section in manifest for page in section["pages"]]
            for path in ("framework/src", "packages/auth/src", "apps/auth", "node_modules/@sxnistxr", "portfolio/dist", "portfolio/engine", "docs", "bench", "ops/backup"):
                (source / path).mkdir(parents=True)
            for path in ["package.json", "bun.lock", "bunfig.toml", "framework/src/cli.ts", "packages/auth/src/index.ts", "portfolio/dist/manifest.json", "bench/results.json", "bench/fullstack-results.json", *doc_sources]:
                (source / path).parent.mkdir(parents=True, exist_ok=True)
                (source / path).write_text("fixture")
            shutil.copyfile(HERE.parent / "backup/optz-backup.py", source / "ops/backup/optz-backup.py")
            (source / "node_modules/@sxnistxr/optz-auth").symlink_to("../../packages/auth", target_is_directory=True)
            release = work / "release"
            (release / "web").mkdir(parents=True)
            (release / "bin").mkdir()
            (release / "bin/twelve-iouring").write_bytes(b"\x7fELFfixture")
            subprocess.run(["bash", "-euc", packaging], cwd=source, env={**os.environ, "work": str(work)}, check=True, capture_output=True)
            units = list((HERE.parent / "systemd").glob("*.service")) + [HERE.parent / "backup/optz-backup.service"]
            for unit in units:
                for relative in re.findall(r"/opt/optz/current/([^\s]+)", unit.read_text()):
                    self.assertTrue((release / relative).exists(), f"{unit.name}: missing {relative}")
            self.assertEqual((release / "web/node_modules/@sxnistxr/optz-auth").resolve(), release / "web/packages/auth")
            self.assertTrue((release / "web/node_modules/@sxnistxr/optz-auth/src/index.ts").is_file())
            for path in ["bench/results.json", "bench/fullstack-results.json", *doc_sources]:
                self.assertEqual((release / "web" / path).read_bytes(), (source / path).read_bytes())
            self.assertEqual((release / "ops/backup/optz-backup.py").stat().st_mode & 0o777, 0o644)
            self.assertFalse((release / "ops/systemd").exists())


class MigrationTests(unittest.TestCase):
    def args(self, root, **kwargs):
        values = dict(repo=root, host="server.example", port=2222, github_repo="example/OPTZ", dry_run=False,
                      configure_github=False, replace_workflow=False, github_token_file=None)
        values.update(kwargs)
        return argparse.Namespace(**values)

    def test_dry_run_has_no_filesystem_or_process_mutations(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as out:
            root = Path(directory); before = list(root.iterdir())
            with patch.object(migration, "run") as run, patch.object(migration, "preflight") as preflight:
                migration.migrate(self.args(root, dry_run=True))
                run.assert_not_called(); preflight.assert_not_called()
            self.assertEqual(list(root.iterdir()), before)
            self.assertIn("no files", out.getvalue())

    @unittest.skipUnless(shutil.which("ssh-keygen"), "OpenSSH key tools required")
    def test_migration_reruns_preserve_key_and_never_restart_app_or_touch_database(self):
        """Verify repeat installs preserve keys, protect secrets, and leave app state alone."""
        real_run = migration.run
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack, redirect_stdout(io.StringIO()):
            root = Path(directory); etc = root / "etc/optz-deploy"; state = root / "state"; build = root / "build"
            lib = root / "usr/local/lib/optz-deploy"; sudoers = root / "etc/sudoers.d/optz-deploy"; host_key = root / "host.pub"
            etc.parent.mkdir(parents=True)
            host_key.write_text("ssh-ed25519 AAAAtest host")
            token_file = root / "token-input"
            token_file.write_text(os.urandom(32).hex())
            args = self.args(root, github_token_file=token_file)
            # Redirect every installed path, including backup destinations, into this sandbox.
            stack.enter_context(patch.object(migration, "ROOT", etc)); stack.enter_context(patch.object(migration, "STATE", state))
            stack.enter_context(patch.object(migration, "BUILD", build)); stack.enter_context(patch.object(migration, "LIB", lib))
            stack.enter_context(patch.object(migration, "SUDOERS", sudoers))
            stack.enter_context(patch.object(migration, "BACKUPS", root / "backups"))
            stack.enter_context(patch.object(migration, "preflight", return_value=(host_key, 3000, None)))
            stack.enter_context(patch.object(migration, "install_account"))
            stack.enter_context(patch.object(migration.os, "chown"))
            stack.enter_context(patch.object(migration.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=os.getuid())))
            stack.enter_context(patch.object(migration.grp, "getgrnam", return_value=types.SimpleNamespace(gr_gid=os.getgid())))
            actions = []
            def execute(argv, **kwargs):
                actions.append([str(x) for x in argv])
                if str(argv[0]) == "ssh-keygen": return real_run(argv, **kwargs)
                return subprocess.CompletedProcess(argv, 0, stdout="")
            stack.enter_context(patch.object(migration, "run", side_effect=execute))
            stack.enter_context(patch.object(migration, "output", side_effect=lambda argv: "not-found" if str(argv[0]) == "systemctl" else subprocess.check_output([str(x) for x in argv], text=True).strip()))
            # The only direct subprocess call checks whether the absent legacy sync is active.
            original_subprocess = subprocess.run
            def process(argv, **kwargs):
                if argv[0] == "systemctl": return subprocess.CompletedProcess(argv, 3)
                return original_subprocess(argv, **kwargs)
            stack.enter_context(patch.object(migration.subprocess, "run", side_effect=process))
            migration.migrate(args)
            self.assertEqual((etc / "github-token").stat().st_mode & 0o777, 0o600)
            self.assertEqual((etc / "github-token").read_bytes(), token_file.read_bytes())
            self.assertEqual((etc / "github-secrets").stat().st_mode & 0o777, 0o700)
            key = (etc / "github_ed25519").read_bytes()
            authorized_keys = etc / ".ssh/authorized_keys"
            self.assertEqual(authorized_keys.stat().st_mode & 0o777, 0o644)
            authorized_keys.chmod(0o600)  # Repair an installation made by the old installer.
            sudo_rule = sudoers.read_bytes()
            migration.migrate(args)
            self.assertEqual((etc / "github-secrets").stat().st_mode & 0o777, 0o700)
            self.assertEqual((etc / "github-token").read_bytes(), token_file.read_bytes())
            snapshots = sorted((root / "backups").iterdir())
            self.assertEqual(len(snapshots), 2)
            saved = snapshots[-1]
            self.assertEqual(saved.stat().st_mode & 0o777, 0o700)
            self.assertEqual((saved / "config/github_ed25519").read_bytes(), key)
            self.assertEqual((saved / "config/github_ed25519").stat().st_mode & 0o777, 0o600)
            self.assertEqual((saved / "config/.ssh/authorized_keys").stat().st_mode & 0o777, 0o600)
            self.assertEqual((saved / "helpers/build.sh").read_bytes(), (HERE / "build.sh").read_bytes())
            self.assertEqual((saved / "sudoers").read_bytes(), sudo_rule)
            self.assertEqual((etc / "github_ed25519").read_bytes(), key)
            self.assertEqual((etc / "github_ed25519").stat().st_mode & 0o777, 0o600)
            self.assertEqual(authorized_keys.stat().st_mode & 0o777, 0o644)
            # Only public helpers/authorized_keys are readable by other accounts.
            for relative in ["github_ed25519", "github-token", "config.json", "deploy.yml",
                             "github-secrets/DEPLOY_HOST", "github-secrets/DEPLOY_PORT",
                             "github-secrets/DEPLOY_KEY", "github-secrets/DEPLOY_KNOWN_HOSTS"]:
                self.assertEqual((etc / relative).stat().st_mode & 0o777, 0o600, relative)
            for name in ["controller.py", "ssh-entry.py", "build.sh"]:
                self.assertEqual((lib / name).stat().st_mode & 0o777, 0o755, name)
            self.assertEqual(sudoers.stat().st_mode & 0o777, 0o440)
            self.assertIn("[server.example]:2222", (etc / "github-secrets/DEPLOY_KNOWN_HOSTS").read_text())
            self.assertIn('restrict,command="/usr/bin/python3 -I', (etc / ".ssh/authorized_keys").read_text())
            self.assertEqual((etc / ".ssh").stat().st_mode & 0o777, 0o755)
            self.assertEqual(lib.stat().st_mode & 0o777, 0o755)
            self.assertFalse(any("restart" in a for a in actions))
            self.assertFalse(any("/var/lib/optz/feed.db" in a for a in actions))

    def test_activation_rechecks_successful_ci_once_after_secrets_are_ready(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack, redirect_stdout(io.StringIO()):
            root = Path(directory)
            stack.enter_context(patch.object(migration, "ROOT", root))
            calls = []
            def api(gh, path, method="GET", data=None):
                calls.append((path, method))
                if path.endswith("branches/main"): return {"commit": {"sha": SHA}}
                if method == "GET": return {"workflow_runs": [{"id":123,"head_sha":SHA,"status":"completed","conclusion":"success"}]}
                return {}
            stack.enter_context(patch.object(migration, "gh_api", side_effect=api))
            migration.activate_ci(["gh"], "example/OPTZ")
            migration.activate_ci(["gh"], "example/OPTZ")
            self.assertEqual(sum(method == "POST" for _, method in calls), 1)
            self.assertIn(("repos/example/OPTZ/actions/runs/123/rerun", "POST"), calls)

    def test_workflow_matches_template_and_gates_on_completed_main_push_ci(self):
        workflow = (HERE.parent.parent / ".github/workflows/deploy.yml").read_text()
        self.assertEqual(workflow, migration.MANAGED + "\n" + (HERE / "deploy.yml").read_text())
        for value in ["workflow_run:", "conclusion == 'success'", "event == 'push'", "head_branch == 'main'", "StrictHostKeyChecking=yes", "environment: production"]:
            self.assertIn(value, workflow)
        self.assertNotIn("actions/checkout", workflow)

    def test_host_cannot_be_an_ssh_option_or_shell(self):
        for host in ["-oProxyCommand=evil", "host;id", "host\nother", "user@host"]:
            with self.assertRaises(ValueError): migration.validate_host(host, 22)
        with self.assertRaises(ValueError): migration.validate_host("example.com", 0)

    def test_environment_approvals_are_preserved_and_workflow_update_is_exact(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory); (root / "github-secrets").mkdir()
            for name in ("DEPLOY_HOST", "DEPLOY_PORT", "DEPLOY_KEY", "DEPLOY_KNOWN_HOSTS"):
                (root / "github-secrets" / name).write_text("secret")
            stack.enter_context(patch.object(migration, "ROOT", root))
            writes = []
            def api(gh, path, method="GET", data=None):
                writes.append((path, method, data))
                if method == "GET": return {"environments": [{"name": "production", "protection_rules": [{"type": "required_reviewers"}]}]}
                return {}
            stack.enter_context(patch.object(migration, "gh_api", side_effect=api))
            calls = stack.enter_context(patch.object(migration, "run"))
            migration.configure_github(["gh"], "example/OPTZ", "workflow", {"sha": "old", "decoded": "previous"})
            self.assertEqual(calls.call_count, 4)
            self.assertFalse(any("/environments/production" in path and method == "PUT" for path, method, _ in writes))
            payload = writes[-1][2]
            self.assertEqual(base64.b64decode(payload["content"]), b"workflow")
            self.assertEqual(payload["sha"], "old")
            self.assertEqual(payload["branch"], "main")


if __name__ == "__main__":
    unittest.main()
