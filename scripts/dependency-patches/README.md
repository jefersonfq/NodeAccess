# Temporary dependency compatibility

`typedoc-minimatch.mjs` bridges TypeDoc 0.28.20's removed `Minimatch.matchOne` call to the public `match(path, partial)` API. It reverses `negate` for the traversal predicate, preserving the old predicate's non-negated meaning. Final file filtering remains TypeDoc's original matcher.

The root `postinstall` applies the patch without fetching code. It accepts only the pinned TypeDoc version and full original source SHA256, or an already patched file that reconstructs that exact original. Unknown code/version fails installation and requires review. Runtime workspace installations without TypeDoc skip it. The active Dockerfiles copy this script before `npm ci`.

This is necessary for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). The published [TypeDoc 0.28.20 source](https://github.com/TypeStrong/typedoc/tree/v0.28.20) still calls the removed API; no compatible upstream release was available during NA-0128. Remove the hook, patch and override when upstream supports a safe minimatch version; do not merely change the expected hash when upgrading.

Matching is not universally identical across minimatch major versions. New partial matching can prune hidden directories earlier; tested final descendants remained excluded. Root-only paths are not passed to TypeDoc's child-directory callback. Patterns containing `**/../` are not claimed equivalent and are absent from this project's documentation configuration. TypeDoc's brace entrypoint root derivation error also reproduces before this update; the patch does not address that separate behavior.

Use Node 24 and npm 12.2.1. The project observed npm 11.12.1 treating workspace override edges as invalid in `npm ls`/SBOM despite installing the locked packages. CI pins npm 12.2.1 before installation; no SBOM/audit policy is disabled. Docker retains its existing npm: the two workspace installation layers were built and their actual corrected versions checked, but npm 11's SBOM limitation remains.

Validation: `npm run test:dependency-compatibility` runs the six real dependency contracts plus five patch/TypeDoc CLI contracts. The security workflow runs it after the strict dependency audit; the normal coverage collector also discovers both tracked test files under `scripts/`. Regenerate Prisma with `npm run db:generate -w apps/backend` after clean installs before backend type/lint checks.
