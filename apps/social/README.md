# social demo

The social feed that used to be on dihlabs.lol, now its own app: a token panel, compose box,
feed and post pages as optz islands, over the Rust engine in `portfolio/engine` (the $12
Server Challenge entry) mounted at `/api/social`.

```sh
# the engine (see portfolio/engine/README.md for a seed database)
cd portfolio/engine && SQLITE_PATH=/tmp/feed.db JWT_SECRET=dev HOST=127.0.0.1 PORT=3000 bash start.sh
# the app
cd apps/social && bun run dev        # http://127.0.0.1:3005
sudo python3 ops/mint-token.py NAME  # on the server: a token to post and like with
```

`ENGINE_URL` points it at another engine.
