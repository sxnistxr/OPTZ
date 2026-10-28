#!/usr/bin/python3 -I
"""Root-owned deployment controller. Never run scripts from the checkout as root."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

CONFIG = Path("/etc/optz-deploy/config.json")
STATE = Path("/var/lib/optz-deploy")
BUILD = Path("/var/cache/optz-build")
RELEASES = Path("/opt/optz/releases")
CURRENT = Path("/opt/optz/current")
LIB = Path("/usr/local/lib/optz-deploy")


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)


def validate_request(sha, run_id):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
        raise ValueError("expected a full lowercase commit SHA and numeric CI run ID")


def github_run(config, run_id):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "optz-deploy", "X-GitHub-Api-Version": "2022-11-28"}
    token = Path(config["github_token_file"]).read_text().strip() if config.get("github_token_file") else ""
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(f'https://api.github.com/repos/{config["repository"]}/actions/runs/{run_id}', headers=headers)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def validate_run(config, record, sha, run_id):
    expected = {
        "id": int(run_id), "head_sha": sha, "head_branch": config["branch"],
        "event": "push", "status": "completed", "conclusion": "success",
    }
    if any(record.get(k) != v for k, v in expected.items()):
        raise ValueError("commit does not have the requested successful push CI run")
    if record.get("path", "").split("@", 1)[0] != ".github/workflows/ci.yml":
        raise ValueError("run was not produced by the trusted CI workflow")
    for field in ("repository", "head_repository"):
        if (record.get(field) or {}).get("full_name", "").lower() != config["repository"].lower():
            raise ValueError("CI run repository mismatch")


def git(config, *args, capture=False):
    # Ignore root's global git configuration; never execute checkout hooks or credential helpers.
    env = {"PATH": "/usr/bin:/bin", "HOME": str(STATE), "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}
    if config.get("github_token_file"):
        import base64
        token = Path(config["github_token_file"]).read_text().strip()
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
                   GIT_CONFIG_VALUE_0="AUTHORIZATION: basic " + base64.b64encode(("x-access-token:" + token).encode()).decode())
    return run(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "--git-dir=" + str(STATE / "repo.git"), *args],
               env=env, stdout=subprocess.PIPE if capture else None, text=capture)


def prepare_source(config, sha):
    repo = STATE / "repo.git"
    if not repo.exists():
        git(config, "init", "--bare", str(repo))
        repo.chmod(0o700)
    git(config, "fetch", "--no-tags", "--no-recurse-submodules", "https://github.com/" + config["repository"] + ".git",
        "+refs/heads/" + config["branch"] + ":refs/heads/deploy")
    if git(config, "rev-parse", "refs/heads/deploy", capture=True).stdout.strip() != sha:
        print("Deployment superseded by a newer branch head; waiting for its CI.")
        return False
    archive = STATE / "source.tar"
    git(config, "archive", "--format=tar", "--output=" + str(archive), sha)
    import grp
    os.chown(archive, 0, grp.getgrnam("optz-build").gr_gid)
    archive.chmod(0o640)
    return True


def validate_tree(root):
    """Allow only regular files/directories and relative links contained in the release."""
    if root.is_symlink() or root.resolve() != root.absolute():
        raise ValueError("artifact root must be a real directory without symlink parents")
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("artifact directory is missing")
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                target = os.readlink(path)
                if os.path.isabs(target) or not path.resolve().is_relative_to(root):
                    raise ValueError("artifact contains an escaping symlink")
            elif not path.is_dir() and not path.is_file():
                raise ValueError("artifact contains a special file")


def build_release(sha):
    existing = RELEASES / ("ci-" + sha)
    if existing.exists():
        if existing.is_symlink() or (existing / "REVISION").read_text().strip() != sha:
            raise ValueError("existing release is not a completed managed build")
        return existing
    # systemd kills the entire build cgroup before returning, including lingering descendants.
    # The unprivileged builder cannot read production secrets or modify installed services.
    properties = ["Type=exec", "KillMode=control-group", "SendSIGKILL=yes", "TimeoutStopSec=15s",
                  "RuntimeMaxSec=30min", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes",
                  "PrivateTmp=yes", "PrivateDevices=yes", "ProtectProc=invisible", "RestrictSUIDSGID=yes",
                  "RestrictNamespaces=yes", "ProtectKernelTunables=yes", "ProtectKernelModules=yes",
                  "ProtectControlGroups=yes", "TasksMax=128", "MemoryMax=1G", "CPUQuota=80%",
                  "CapabilityBoundingSet=", "UMask=0077", "ReadWritePaths=" + str(BUILD),
                  "InaccessiblePaths=/etc/optz /var/lib/optz -/var/backups/optz /etc/optz-deploy"]
    run(["/usr/bin/systemd-run", "--unit=optz-build", "--wait", "--collect", "--pipe", "--quiet",
         "--uid=optz-build", "--gid=optz-build", *["--property=" + p for p in properties],
         "/bin/bash", str(LIB / "build.sh")], timeout=1850)
    source = BUILD / "work/release"
    validate_tree(source)
    binary = source / "bin/twelve-iouring"
    if binary.is_symlink() or not binary.is_file():
        raise ValueError("build did not produce a regular ELF engine binary")
    with binary.open("rb") as stream:
        if stream.read(4) != b"\x7fELF":
            raise ValueError("build did not produce an ELF engine binary")
    if not (source / "web/portfolio/dist/manifest.json").is_file():
        raise ValueError("build did not produce the site manifest")
    release = RELEASES / ("ci-" + sha)
    if release.exists():
        if release.is_symlink() or (release / "REVISION").read_text().strip() != sha:
            raise ValueError("existing release is not a completed managed build")
        return release
    temporary = RELEASES / (".ci-" + sha)
    if temporary.exists():
        shutil.rmtree(temporary)
    try:
        shutil.copytree(source, temporary, symlinks=True)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    # Remove write access and special permission bits; copied artifacts are never executed as root.
    for directory, dirs, files in os.walk(temporary, followlinks=False):
        Path(directory).chmod(0o755)
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink():
                path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
    (temporary / "REVISION").write_text(sha + "\n")
    temporary.rename(release)
    return release


def switch(release):
    link = CURRENT.with_name("current.autodeploy")
    link.unlink(missing_ok=True)
    link.symlink_to(release)
    link.replace(CURRENT)


def healthy(port):
    for url in (f"http://127.0.0.1:{port}/health", "http://127.0.0.1:3001/"):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=2) as response:
                if response.status != 200:
                    return False
        except (OSError, urllib.error.URLError):
            return False
    return True


def promote(release, port):
    previous = CURRENT.resolve(strict=True)
    if not previous.is_relative_to(RELEASES.resolve()) or not previous.is_dir():
        raise ValueError("current release is outside the managed release directory")
    switch(release)
    try:
        run(["/usr/bin/systemctl", "restart", "optz.service", "optz-web.service"], timeout=60)
        for _ in range(30):
            if healthy(port):
                return
            time.sleep(1)
        raise ValueError("new release failed health checks")
    except Exception:
        switch(previous)
        run(["/usr/bin/systemctl", "restart", "optz.service", "optz-web.service"], timeout=60)
        if not healthy(port):
            raise RuntimeError("rollback restored the previous release, but its health check failed") from None
        raise


def purge_cdn():
    values = {}
    for line in Path("/etc/optz/env").read_text().splitlines():
        name, sep, value = line.partition("=")
        if sep and name in ("CF_ZONE_ID", "CF_API_TOKEN"):
            values[name] = value
    if not values.get("CF_ZONE_ID") or not values.get("CF_API_TOKEN"):
        return
    try:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", values["CF_ZONE_ID"]):
            raise ValueError("invalid zone ID")
        req = urllib.request.Request("https://api.cloudflare.com/client/v4/zones/" + values["CF_ZONE_ID"] + "/purge_cache",
            data=b'{"purge_everything":true}', method="POST",
            headers={"Authorization": "Bearer " + values["CF_API_TOKEN"], "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            if not json.load(response).get("success"):
                raise ValueError("purge was rejected")
    except (OSError, ValueError):
        print("Warning: CDN purge failed; release is live, investigate the CDN cache.", file=sys.stderr)


def prune(previous):
    # Only touch this controller's release namespace, keeping five plus the rollback target.
    candidates = [p for p in RELEASES.iterdir() if re.fullmatch(r"ci-[0-9a-f]{40}", p.name) and not p.is_symlink() and p.is_dir()]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    protected = {CURRENT.resolve(), previous}
    for path in candidates[5:]:
        if path not in protected:
            shutil.rmtree(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sha")
    parser.add_argument("run_id")
    args = parser.parse_args()
    validate_request(args.sha, args.run_id)
    if os.geteuid() != 0:
        raise ValueError("controller must be invoked through its restricted sudo rule")
    os.umask(0o077)
    config = json.loads(CONFIG.read_text())
    with (STATE / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        validate_run(config, github_run(config, args.run_id), args.sha, args.run_id)
        marker = STATE / "last-success.json"
        if marker.exists() and json.loads(marker.read_text()).get("sha") == args.sha and CURRENT.resolve() == RELEASES / ("ci-" + args.sha):
            if healthy(config["engine_port"]):
                print("Commit already deployed and healthy.")
                return
        if not prepare_source(config, args.sha):
            return
        release = build_release(args.sha)
        # Recheck branch and CI after the build, before any live change.
        validate_run(config, github_run(config, args.run_id), args.sha, args.run_id)
        git(config, "fetch", "--no-tags", "https://github.com/" + config["repository"] + ".git",
            "+refs/heads/" + config["branch"] + ":refs/heads/deploy")
        if git(config, "rev-parse", "refs/heads/deploy", capture=True).stdout.strip() != args.sha:
            if CURRENT.resolve() != release:
                shutil.rmtree(release)
            print("Build superseded; live release unchanged.")
            return
        previous = CURRENT.resolve()
        try:
            promote(release, config["engine_port"])
        except Exception:
            if CURRENT.resolve() != release:
                shutil.rmtree(release)
            raise
        marker.write_text(json.dumps({"sha": args.sha, "run_id": args.run_id}) + "\n")
        purge_cdn()
        prune(previous)
        print("Deployed " + args.sha)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print("deploy: " + str(error), file=sys.stderr)
        sys.exit(1)
