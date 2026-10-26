#!/bin/bash
# Cloud sessions only: install the workspace and graphify, and build the code graph so the
# graphify hooks and `graphify query` work from the first prompt.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

command -v bun >/dev/null || { curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; }
bun install

export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
command -v graphify >/dev/null || uv tool install graphifyy
echo "export PATH=\"$HOME/.local/bin:$HOME/.bun/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"

# Code only (no LLM calls); a few seconds. graphify-out/ is gitignored.
graphify extract . --code-only >/dev/null
graphify cluster-only . --no-label --no-viz >/dev/null
