# VPS auto-sync

The VPS polls GitHub every 30 seconds and pulls new commits on `main` into
`/srv/optz`. After each update it runs `deploy/post-deploy.sh`, so edit that
file to build or restart whatever needs to go live.

## One-time setup (on the VPS)

```sh
ssh vps3760075@62.35.162.49
curl -fsSL https://raw.githubusercontent.com/sxnistxr/OPTZ/main/deploy/setup-vps.sh | sudo bash
```

## Useful commands

- Follow sync logs: `journalctl -u optz-sync.service -f`
- Force a sync now: `sudo systemctl start optz-sync.service`
- Stop syncing: `sudo systemctl disable --now optz-sync.timer`

Note: each update discards local edits and untracked (non-gitignored) files in
`/srv/optz`, so
keep runtime data (uploads, databases, `.env`) outside that directory.
