#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_PNPM_VERSION="10.15.0"
readonly EXPECTED_LOCK_SHA256="2f63d7d3ebae1f017606b4d22dc2e5508003c0cd0988374ce0f856fd14a27234"

actual_pnpm_version="$(pnpm --version)"
if [[ "${actual_pnpm_version}" != "${EXPECTED_PNPM_VERSION}" ]]; then
  echo "pnpm version mismatch: expected ${EXPECTED_PNPM_VERSION}, got ${actual_pnpm_version}" >&2
  exit 1
fi

# Recreate the lock snapshot from manifests rather than relying on a retained
# GitHub Actions log or any pre-existing local lockfile. Package lifecycle
# scripts remain disabled during resolution.
#
# pnpm 10.x re-resolves the full graph for lockfile-only generation. That means
# an upstream transitive release can intentionally trip this hash even when our
# direct manifests did not change. Treat such a mismatch as a supply-chain
# review boundary: inspect the authoritative CI resolution before changing this
# value; never fall back to an unverified fresh install.
rm -f pnpm-lock.yaml
pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile

if command -v sha256sum >/dev/null 2>&1; then
  actual_lock_sha256="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
else
  actual_lock_sha256="$(shasum -a 256 pnpm-lock.yaml | awk '{print $1}')"
fi

if [[ "${actual_lock_sha256}" != "${EXPECTED_LOCK_SHA256}" ]]; then
  echo "pnpm lock snapshot drifted." >&2
  echo "expected: ${EXPECTED_LOCK_SHA256}" >&2
  echo "actual:   ${actual_lock_sha256}" >&2
  echo "Dependency changes require an intentional lock-snapshot review and hash update." >&2
  exit 1
fi

# Keep the previously-reviewed AWS peer alignment explicit. These checks make
# an accidental regression obvious even before package installation begins.
grep -Fq "specifier: 3.1111.0" pnpm-lock.yaml
grep -Fq "version: 3.1103.0(@aws-sdk/client-dynamodb@3.1111.0)" pnpm-lock.yaml

printf 'Verified pnpm lock snapshot %s\n' "${actual_lock_sha256}"
