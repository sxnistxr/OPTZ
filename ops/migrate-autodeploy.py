#!/usr/bin/env python3
"""Migrate an existing Ubuntu OPTZ VPS to CI-gated SSH deployment. No database writes."""
import argparse
import base64
from datetime import datetime, timezone
import grp
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path("/etc/optz-deploy")
LIB = Path("/usr/local/lib/optz-deploy")
STATE = Path("/var/lib/optz-deploy")
BUILD = Path("/var/cache/optz-build")
SUDOERS = Path("/etc/sudoers.d/optz-deploy")
BACKUPS = Path("/var/backups/optz-autodeploy")
MANAGED = "# Managed by OPTZ migrate-autodeploy.py"


def run(argv, **kwargs):
    return subprocess.run([str(x) for x in argv], check=True, **kwargs)


def output(argv):
    return run(argv, stdout=subprocess.PIPE, text=True).stdout.strip()


def validate_host(host, port):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", host) or not 1 <= port <= 65535:
        raise ValueError("host must be a DNS name or IPv4 address; SSH port must be 1–65535")


def repository_name(repo, override):
    if override:
        name = override
    else:
        url = output(["git", "-c", "safe.directory=" + str(repo), "-C", repo, "remote", "get-url", "origin"])
        match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?", url)
        if not match:
            raise ValueError("cannot infer GitHub repository; pass --github-repo OWNER/REPO")
        name = match[1]
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*", name):
        raise ValueError("invalid GitHub OWNER/REPO")
    return name


def write(path, content, mode=0o600):
    """Publish configuration atomically; never follow an existing destination symlink."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".optz-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content.encode() if isinstance(content, str) else content)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def gh_command():
    if not shutil.which("gh"):
        raise ValueError("--configure-github needs GitHub CLI (apt install gh), or omit that flag to generate setup files")
    if os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"):
        return [shutil.which("gh")]
    user = os.environ.get("SUDO_USER")
    if user and user != "root":
        return ["runuser", "-u", user, "--", shutil.which("gh")]
    return [shutil.which("gh")]


def gh_api(gh, path, method="GET", data=None):
    args = gh + ["api", "--hostname", "github.com", "--method", method, path]
    result = run(args + (["--input", "-"] if data is not None else []),
                 input=json.dumps(data) if data is not None else None, text=True, stdout=subprocess.PIPE)
    return json.loads(result.stdout) if result.stdout.strip() else None


def existing_file(gh, repository):
    # List the directory to distinguish a missing file from authentication/network failures.
    files = gh_api(gh, f"repos/{repository}/contents/.github/workflows?ref=main")
    entry = next((f for f in files if f["name"] == "deploy.yml"), None)
    if entry is None:
        return None
    record = gh_api(gh, f"repos/{repository}/contents/.github/workflows/deploy.yml?ref=main")
    record["decoded"] = base64.b64decode(record["content"]).decode()
    return record


def configure_github(gh, repository, workflow, existing):
    environments = gh_api(gh, f"repos/{repository}/environments?per_page=100")["environments"]
    if not any(e["name"] == "production" for e in environments):
        gh_api(gh, f"repos/{repository}/environments/production", "PUT", {
            "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}})
        gh_api(gh, f"repos/{repository}/environments/production/deployment-branch-policies", "POST", {"name": "main", "type": "branch"})
    # Existing approval and branch rules are intentionally preserved.
    for name in ("DEPLOY_HOST", "DEPLOY_PORT", "DEPLOY_KEY", "DEPLOY_KNOWN_HOSTS"):
        with (ROOT / "github-secrets" / name).open("rb") as secret:
            run(gh + ["secret", "set", name, "--repo", "github.com/" + repository, "--env", "production"], stdin=secret)
    if existing is None or existing["decoded"] != workflow:
        payload = {"message": "Enable CI-gated OPTZ deployment", "branch": "main", "content": base64.b64encode(workflow.encode()).decode()}
        if existing:
            payload["sha"] = existing["sha"]
        gh_api(gh, f"repos/{repository}/contents/.github/workflows/deploy.yml", "PUT", payload)


def activate_ci(gh, repository):
    """A completed CI event predating setup cannot trigger the newly installed workflow."""
    sha = gh_api(gh, f"repos/{repository}/branches/main")["commit"]["sha"]
    marker = ROOT / "activation.json"
    if marker.exists() and json.loads(marker.read_text()).get("sha") == sha:
        return
    records = gh_api(gh, f"repos/{repository}/actions/workflows/ci.yml/runs?event=push&branch=main&per_page=1")["workflow_runs"]
    if records and records[0]["head_sha"] == sha:
        record = records[0]
        if record["status"] == "completed" and record["conclusion"] == "success":
            gh_api(gh, f"repos/{repository}/actions/runs/{record['id']}/rerun", "POST", {})
            print("Started a fresh CI run so the configured deployment can activate without another push.")
        elif record["status"] == "completed":
            print("Latest CI did not pass; deployment will wait for a successful main push.")
    else:
        print("No current main CI run found; the next main push will activate deployment.")
    write(marker, json.dumps({"sha": sha}) + "\n", 0o600)


def preflight(repo, configure, gh, repository, workflow, replace_workflow):
    if os.geteuid() != 0:
        raise ValueError("apply mode requires sudo; --dry-run does not")
    for name in ("git", "python3", "systemctl", "systemd-run", "runuser", "sudo", "visudo", "ssh-keygen", "useradd", "usermod"):
        if not shutil.which(name):
            raise ValueError("missing prerequisite: " + name)
    for file in (Path("/etc/optz/env"), Path("/opt/bun/bin/bun"), Path("/opt/rust-1.99.1/bin/cargo")):
        if not file.is_file():
            raise ValueError("existing production installation required; missing " + str(file))
    current = Path("/opt/optz/current").resolve(strict=True)
    if not current.is_relative_to(Path("/opt/optz/releases").resolve()) or not current.is_dir():
        raise ValueError("current release is not in /opt/optz/releases")
    for service in ("optz.service", "optz-web.service"):
        run(["systemctl", "is-active", "--quiet", service])
        if output(["systemctl", "show", "-p", "User", "--value", service]) != "optz":
            raise ValueError(service + " must already run as optz")
    if subprocess.run(["systemctl", "is-active", "--quiet", "optz-sync.service"]).returncode == 0:
        raise ValueError("legacy sync is currently deploying; wait for it to finish and retry")
    for path in (ROOT, LIB, STATE, Path("/opt/optz"), Path("/opt/optz/releases")):
        if path.is_symlink() or (path.exists() and (path.stat().st_uid != 0 or path.stat().st_mode & 0o022)):
            raise ValueError("installation path must be root-owned and not writable by others: " + str(path))
    for path in (ROOT / ".ssh", ROOT / "github-secrets", ROOT / "github_ed25519"):
        if path.is_symlink() or (path.exists() and path.stat().st_uid != 0):
            raise ValueError("unsafe existing key/configuration path: " + str(path))
    sshd = shutil.which("sshd")
    if not sshd:
        raise ValueError("existing OpenSSH server required; sshd is missing")
    configured_keys = [Path(line.split(maxsplit=1)[1] + ".pub") for line in output([sshd, "-T"]).splitlines() if line.startswith("hostkey ")]
    host_keys = [p for p in configured_keys if p.is_file()]
    host_keys.sort(key=lambda p: "ed25519" not in p.name)
    if not host_keys:
        raise ValueError("no installed SSH host public key; configure OpenSSH first")
    run(["ssh-keygen", "-l", "-f", host_keys[0]], stdout=subprocess.DEVNULL)
    for user, home, shell in (("optz-deploy", ROOT, "/bin/sh"), ("optz-build", BUILD / "home", "/usr/sbin/nologin")):
        try:
            account = pwd.getpwnam(user)
        except KeyError:
            continue
        try:
            expected_gid = grp.getgrnam(user).gr_gid
        except KeyError:
            raise ValueError("existing account has no matching group: " + user) from None
        if account.pw_uid == 0 or account.pw_gid != expected_gid or account.pw_dir != str(home) or account.pw_shell != shell:
            raise ValueError("existing account conflicts with migration: " + user)
    existing = None
    if configure:
        meta = gh_api(gh, f"repos/{repository}")
        if meta["default_branch"] != "main":
            raise ValueError("this migration targets repositories whose default branch is main")
        existing = existing_file(gh, repository)
        if existing and existing["decoded"] != workflow and MANAGED not in existing["decoded"] and not replace_workflow:
            raise ValueError("deploy.yml already exists; review it and use --replace-workflow to replace it explicitly")
    port_lines = [line[5:] for line in Path("/etc/optz/env").read_text().splitlines() if line.startswith("PORT=")]
    if len(port_lines) != 1 or not port_lines[0].isdigit() or not 1 <= int(port_lines[0]) <= 65535:
        raise ValueError("/etc/optz/env must contain one numeric PORT entry")
    return host_keys[0], int(port_lines[0]), existing


def install_account(user, home, shell):
    try:
        pwd.getpwnam(user)
    except KeyError:
        run(["useradd", "--system", "--user-group", "--home-dir", str(home), "--shell", shell, user])
    run(["usermod", "-G", "", user])


def migrate(args):
    repo = args.repo.resolve()
    components = Path(__file__).resolve().parent / "autodeploy"
    validate_host(args.host, args.port)
    repository = repository_name(repo, args.github_repo)
    workflow = MANAGED + "\n" + (components / "deploy.yml").read_text()
    plan = {"repository": repository, "branch": "main", "host": args.host, "port": args.port,
            "build_user": "optz-build", "ssh_user": "optz-deploy", "github": args.configure_github,
            "actions": ["validate existing production services", "back up deployment configuration",
                        "stop legacy polling timer", "install root-owned constrained controller",
                        "generate/preserve dedicated SSH key", "prepare pinned host key and environment secrets",
                        "configure GitHub workflow/secrets if requested", "retire old HTTP runner"],
            "unchanged": ["running app services", "database", "runtime env file", "nginx config", "systemd app units"]}
    print(json.dumps(plan, indent=2), flush=True)
    if args.dry_run:
        print("Dry run: no files, accounts, services, GitHub settings or keys were changed.")
        return
    gh = gh_command() if args.configure_github else None
    host_key, engine_port, existing = preflight(repo, args.configure_github, gh, repository, workflow, args.replace_workflow)
    if args.github_token_file and (not args.github_token_file.is_file() or not args.github_token_file.read_text().strip()):
        raise ValueError("GitHub API/read token file is missing or empty")
    backup = BACKUPS / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True, mode=0o700)
    for path in (ROOT, LIB, SUDOERS):
        if path.exists():
            if path.is_dir():
                shutil.copytree(path, backup / path.name, symlinks=True)
            else:
                shutil.copy2(path, backup / path.name)
    state = {unit: {prop: output(["systemctl", "show", "-p", prop, "--value", unit]) for prop in ("ActiveState", "UnitFileState")}
             for unit in ("optz-sync.timer", "optz-sync.service", "optz-runner.service")}
    write(backup / "legacy-services.json", json.dumps(state, indent=2), 0o600)
    # Stop new legacy deployments without killing an in-flight release switch.
    if output(["systemctl", "show", "-p", "LoadState", "--value", "optz-sync.timer"]) != "not-found":
        run(["systemctl", "disable", "--now", "optz-sync.timer"])
    if subprocess.run(["systemctl", "is-active", "--quiet", "optz-sync.service"]).returncode == 0:
        raise ValueError("a legacy deploy raced the migration; timer is now stopped, retry after that deploy completes")
    ROOT.mkdir(mode=0o755, exist_ok=True)
    ROOT.chmod(0o755)
    LIB.mkdir(parents=True, mode=0o755, exist_ok=True)
    LIB.chmod(0o755)
    install_account("optz-deploy", ROOT, "/bin/sh")
    install_account("optz-build", BUILD / "home", "/usr/sbin/nologin")
    STATE.mkdir(parents=True, mode=0o750, exist_ok=True)
    STATE.chmod(0o750)
    os.chown(STATE, 0, grp.getgrnam("optz-build").gr_gid)
    BUILD.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chown(BUILD, pwd.getpwnam("optz-build").pw_uid, grp.getgrnam("optz-build").gr_gid)
    for name in ("controller.py", "ssh-entry.py", "build.sh"):
        write(LIB / name, (components / name).read_bytes(), 0o755)
    config = {"repository": repository, "branch": "main", "engine_port": engine_port}
    if args.github_token_file:
        write(ROOT / "github-token", args.github_token_file.read_bytes(), 0o600)
        config["github_token_file"] = str(ROOT / "github-token")
    elif (ROOT / "config.json").exists():
        old = json.loads((ROOT / "config.json").read_text())
        if old.get("github_token_file"):
            config["github_token_file"] = old["github_token_file"]
    write(ROOT / "config.json", json.dumps(config, indent=2) + "\n", 0o600)
    key = ROOT / "github_ed25519"
    if not key.exists():
        run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "optz-github-deploy", "-f", key])
    key.chmod(0o600)
    public = output(["ssh-keygen", "-y", "-f", key])
    (ROOT / ".ssh").mkdir(mode=0o755, exist_ok=True)
    (ROOT / ".ssh").chmod(0o755)
    # sshd reads authorized_keys as the login user. Keep this public key root-owned and
    # non-writable by optz-deploy, but readable; private keys and secrets remain 0600.
    write(ROOT / ".ssh/authorized_keys", 'restrict,command="/usr/bin/python3 -I /usr/local/lib/optz-deploy/ssh-entry.py" ' + public + "\n", 0o644)
    sudo_rule = "optz-deploy ALL=(root) NOPASSWD: /usr/local/lib/optz-deploy/controller.py *\n"
    with tempfile.NamedTemporaryFile(mode="w") as f:
        f.write(sudo_rule); f.flush()
        run(["visudo", "-cf", f.name], stdout=subprocess.DEVNULL)
    write(SUDOERS, sudo_rule, 0o440)
    secret_dir = ROOT / "github-secrets"
    secret_dir.mkdir(mode=0o700, exist_ok=True)
    secret_dir.chmod(0o700)
    host_label = args.host if args.port == 22 else f"[{args.host}]:{args.port}"
    key_fields = host_key.read_text().split()
    values = {"DEPLOY_HOST": args.host, "DEPLOY_PORT": str(args.port), "DEPLOY_KEY": key.read_text(),
              "DEPLOY_KNOWN_HOSTS": host_label + " " + " ".join(key_fields[:2])}
    for name, value in values.items():
        write(secret_dir / name, value.rstrip("\n") + "\n", 0o600)
    write(ROOT / "deploy.yml", workflow)
    if args.configure_github:
        configure_github(gh, repository, workflow, existing)
        activate_ci(gh, repository)
    # Retire the HTTP runner only after the replacement installation succeeds.
    for unit in ("optz-sync.service", "optz-runner.service"):
        if output(["systemctl", "show", "-p", "LoadState", "--value", unit]) != "not-found":
            run(["systemctl", "disable", "--now", unit])
    print("Migration installed. Existing app and database were left running.")
    print("Configuration backup: " + str(backup))
    print("Dedicated SSH key preserved at " + str(key) + " (not printed).")
    if args.configure_github:
        print("GitHub production environment secrets and deploy workflow configured. Successful main CI will trigger deployment.")
    else:
        print("GitHub activation remains: rerun with --configure-github after authenticating gh, or follow ops/autodeploy/README.md.")
        print("Workflow: " + str(ROOT / "deploy.yml") + "; secret input files are stored in the managed root-only secrets directory.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--host", required=True, help="public DNS name or IPv4 address used by GitHub to SSH to this VPS")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--github-repo", help="OWNER/REPO; default inferred from origin")
    parser.add_argument("--github-token-file", type=Path, help="optional read-only Contents+Actions token for private repos/API limits; stored root-only")
    parser.add_argument("--configure-github", action="store_true", help="use authenticated gh to install environment secrets and workflow")
    parser.add_argument("--replace-workflow", action="store_true", help="explicitly replace an existing non-managed deploy.yml")
    parser.add_argument("--dry-run", action="store_true")
    try:
        migrate(parser.parse_args())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit("migration: " + str(error) + ". Re-run safely after correcting the problem; the app/database were not restarted by migration.")
