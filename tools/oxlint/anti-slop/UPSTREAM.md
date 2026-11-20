# anti-slop provenance

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), skill `skills/install-anti-slop`, bundled assets `assets/anti-slop/`.

Installed with that skill's `scripts/install.mjs`, run from `cli/` on 2026-11-19.

Source commit: unknown. The local skill install records no commit, only its folder hash.

Pristine snapshot, as git tree object ids:

- `skills/install-anti-slop` tree `97962dc9fad565ca7695bf57805d9d0138ce1def`. This matches `skillFolderHash` in the installer's `~/.agents/.skill-lock.json`.
- `skills/install-anti-slop/assets/anti-slop` tree `54b50f11bed7f52ca1948f8802f4df591644762f`. This directory, minus this file, hashes to the same tree.

To find the source commit, search upstream history for a commit whose `skills/install-anti-slop` tree is the id above.

Installed paths:

- `cli/tools/oxlint/anti-slop/index.ts`, the generic plugin `anti-slop`.
- `cli/tools/oxlint/anti-slop/effect/index.ts`, the Effect plugin `anti-slop-effect`, enabled because `effect` is a direct dependency of `cli/package.json`.
- `cli/tools/oxlint/anti-slop/vendor/eslint-stylistic/`, with its own `LICENSE` and `UPSTREAM.md`.

Configuration lives in `cli/.oxlintrc.json`. Every generic rule, `oxc/no-accumulating-spread` and every Effect rule is at `error`, with default options.

Dependencies: `oxlint` and `@oxlint/plugins`, both pinned at `1.94.0`.

Intentional deviations: none.
