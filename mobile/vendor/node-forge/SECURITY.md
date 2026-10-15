# Local node-forge security patch

Official npm node-forge 1.4.0 source (original license retained), with only the
nested DigestAlgorithm child-count fix to lib/rsa.js from upstream PR #1152,
head ceba34402e329f0365134f23fe19898756527d65. The upstream PR is not merged or
released as of 2026-10-15. This local fork is not an official upstream release.

Regression: mobile/tests/node-forge-security.test.cjs. Provenance and risk notes:
.superstack/security-reports/lumenless-privacy-2026-10-15.md at repository root.
