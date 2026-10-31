# @sxnistxr/optz-uploads

Optional OPTZ module. No default browser initialization or static-request work.

See the [complete guide](../../docs/UPLOADS.md) for setup, APIs, security boundaries and examples.
Source exports live in `src/`; checks are `bun test` and `bun run check` from this package.

Install it next to the framework. The framework is imported as `optz`, so install it under that name:

```sh
bun add optz@npm:@sxnistxr/optz @sxnistxr/optz-uploads
```

Inside this repository, use a `workspace:*` dependency and run `bun install` at the root.
