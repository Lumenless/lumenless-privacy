# Dependency security remediation — 2026-10-15

Scope: web/Business production Next.js application, existing mobile app, and
Solana program JavaScript tooling. This is a dependency audit and remediation,
not a full application or smart-contract audit. No financial transactions or
production credentials were used in regression tests.

## Baseline and result

| Tree / tool | Before critical / high | After critical / high |
| --- | --- | --- |
| web, npm audit (all dependencies) | 0 / 29 | 0 / 0 |
| web, npm audit --omit=dev | See original all-dependency baseline | 0 / 0 |
| mobile, npm audit | 5 / 56 | 0 / 0 |
| solana-program, Yarn Classic audit | 0 / 29 | 0 / 0 |

These are advisory dependency/path counts reported by the individual tools,
not distinct exploitable endpoints. Yarn and npm counts are not comparable.
Remaining low/moderate advisories are tracked separately; this change does not
claim that there are no vulnerabilities of any severity.

## Changes

- Removed unused web copy-webpack-plugin (no imports/config references). This
  removes its vulnerable serialize-javascript dependency rather than upgrading
  unused functionality.
- Pinned overrides for TOML 4.2.0 (Anchor config parser) and image-size 2.0.4.
  The latter retains __esModule/default exports required by Metro. Tested real
  Anchor config parsing, PNG dimensions, and hostile TOML input.
- Mobile compatible lockfile updates resolve critical protobufjs, tar,
  shell-quote, websocket-driver and fast-xml-parser chains. Additional overrides
  fix gRPC, postcss, underscore, websocket and jsonpath chains; sharp is 0.35.5.
  Existing RN remains 0.81.5; Metro config is pinned to the same version and
  Community CLI to 20.2.0. No Expo migration or new Expo direct dependencies.
- Solana test tooling moves to Mocha 11.8.0 and ts-mocha 11.1.0, with explicit
  ts-node and Node types, and a patched serialize-javascript resolution. Anchor
  remains 0.32.1. This does not deploy or change on-chain program instructions.

## Unreleased upstream fixes / local packages

These are real code replacements, not audit suppressions. The scoped local
packages are not covered by upstream npm advisory matching. Their provenance,
patches and security regression tests must be maintained until a reviewed
upstream replacement is available. Ordinary npm audit alone cannot assess them.

### bigint-buffer — GHSA-3gc7-fjrx-p6mg

https://github.com/advisories/GHSA-3gc7-fjrx-p6mg

Upstream <=1.1.5 has no patched release. Replaced with four compatible unsigned
BigInt/Buffer operations implemented in JavaScript, with no native addon,
install scripts or dependencies. Rejects negative/overflowing values rather
than truncating them; rejects invalid widths. Maintains original byte order and
never mutates input buffers. Tests cover u64/u128/u256 Solana layouts, both endian
orders, empty and >128-byte buffers, and invalid numeric boundaries.

### braces — GHSA-vfj7-8cjw-p6xm

https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Based on installed upstream 3.0.3 source, retaining MIT license and fill-range
7.1.1. Added a fixed parser stack-depth limit (128) and iterative validation of
AST inputs to recursive compile/expand/stringify walkers (depth 128, node budget
100,000, cycle rejection). Caller options cannot disable these limits. Normal
globs/ranges and malicious nested patterns/cyclic ASTs are tested. Identical
source copies live within web and mobile so each deployment root is standalone.

### node-forge — GHSA-86w9-cpqp-85rv (mobile tooling only)

https://github.com/advisories/GHSA-86w9-cpqp-85rv
https://github.com/digitalbazaar/forge/pull/1152

Official npm 1.4.0 source, retaining original dual license. Applied the nested
DigestAlgorithm child-count check from upstream PR #1152, head
ceba34402e329f0365134f23fe19898756527d65. The PR is OPEN, not a released or merged
upstream fix as of this review. The local change rejects extra children with or
without optional NULL parameters in the nested sequence. Tests preserve valid
RSA SHA-256 verification, reject a wrong digest, and reject privately signed
malformed DigestInfo values (using ephemeral test keys). No other forge code
changes. This package is used by existing Expo certificate/build tooling; web
and escrow continue using their original cryptographic libraries.

## Validation and limitations

- Clean web npm ci --ignore-scripts, all 87 web tests, TypeScript and production
  next build passed after replacements.
- Shared hardening suite passes for both installed dependency trees; dedicated
  node-forge regression passes. Updated sharp parses a PNG; jsonpath query works.
- Solana ts-mocha CLI, Anchor import and Anchor.toml parser smoke tests pass.
- No mobile device/native release build or on-chain integration test was run.
  Existing mobile Expo setup is retained; migration requires separate approval.
- Dependency CI checks all three JavaScript trees and fails on high/critical or
  audit service failures. Official GitHub Actions are pinned to commit SHAs.
  This workflow alone does not configure GitHub branch protection or block Vercel.

## Rust follow-up

cargo-audit 0.22.2 against current RustSec reports zero vulnerabilities. Updated
compatible lockfile versions anyhow 1.0.100 → 1.0.104, keccak 0.1.5 → 0.1.6, and
rand 0.8.5 → 0.8.8. This resolves their soundness notices and the yanked keccak
version. `cargo check --locked` passed. CI also runs RustSec and cargo check.

Three informational warnings remain: unmaintained bincode 1.3.3 and
libsecp256k1 0.6.0, and the rand 0.7.3 custom-logger reentrancy soundness notice
RUSTSEC-2026-0097 (no CVSS score). The latter has no compatible 0.7 patch and
comes through the legacy Solana dependency graph. No advisory is suppressed.
These are not evidence of an exploitable web/Business endpoint, and are not
silently classified as resolved. Further Rust ecosystem migration is separate
from these compatible dependency fixes.

The existing Solana TypeScript integration-test stub references an `initialize`
method absent from the generated IDL; its standalone tsc check fails on that
pre-existing stub. This dependency change does not claim on-chain integration
coverage. CLI smoke tests and Rust program compilation passed.

## Confidence / tracking

Known vulnerable dependency versions were confirmed with the registry audit and
upstream advisories (high confidence). Local replacements have explicit
regression tests; this is not an independent cryptographic audit of the forks.
Current critical/high audit entries: 0. Remaining lower-severity advisories:
web 45 (15 low, 30 moderate), mobile 40 (4 low, 36 moderate), Solana JS 8
(1 low, 7 moderate). Re-run CI regularly because advisory data changes.

## CI portability follow-up

Initial GitHub Linux install used npm 11.19.0, whereas the local toolchain was
npm 11.6.2. Its stricter lockfile validation found a missing optional bufferutil
entry. Lockfiles were regenerated with npm 11.19.0 and CI now pins that npm
version. Actions use Node 24-native checkout/setup-node v6 at verified immutable
SHAs. This is a lockfile compatibility fix; no audit rule was relaxed.
