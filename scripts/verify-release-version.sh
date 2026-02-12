#!/usr/bin/env bash

set -euo pipefail

TAG_NAME="${GITHUB_REF_NAME:-${1:-}}"
if [[ -z "${TAG_NAME}" ]]; then
  echo "release tag is required (expected GITHUB_REF_NAME like v0.1.3)" >&2
  exit 1
fi

if [[ ! "${TAG_NAME}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid release tag '${TAG_NAME}' (expected format vX.Y.Z)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to verify release version parity" >&2
  exit 1
fi

TAURI_VERSION="$(jq -r '.version // empty' apps/desktop/src-tauri/tauri.conf.json)"
if [[ -z "${TAURI_VERSION}" ]]; then
  echo "apps/desktop/src-tauri/tauri.conf.json is missing a version" >&2
  exit 1
fi

EXPECTED_TAG="v${TAURI_VERSION}"
if [[ "${TAG_NAME}" != "${EXPECTED_TAG}" ]]; then
  echo "release tag/version mismatch: tag='${TAG_NAME}', tauri.conf.json='${TAURI_VERSION}'" >&2
  exit 1
fi

echo "release version parity verified: ${TAG_NAME}"
