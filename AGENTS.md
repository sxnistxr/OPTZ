# Repository instructions

- Use Graphify for codebase navigation. Run `graphify query "<question>"` before source searches when `graphify-out/graph.json` exists. Use `graphify path` or `graphify explain` for focused relationships. Initialize or refresh the AST graph with `graphify update .` when needed, including after code changes. Verify relevant source rather than treating graph output as authoritative.
- Route terminal commands through RTK: use supported wrappers, or `rtk bypass` for unsupported commands and exact output. Check exit codes and recover full diagnostics when needed.
- Carry these Graphify and RTK instructions into any authorized subagent tasks.
- Production deploys from `main`; commit and push there when deployment is requested. Do not include session links in commits or pull request descriptions.
