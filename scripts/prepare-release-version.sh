#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift || true
fi

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "release version is required (example: 0.1.11)" >&2
  exit 1
fi

if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid release version '${VERSION}' (expected format X.Y.Z)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to prepare release versions" >&2
  exit 1
fi

update_manifest_version() {
  local file_path="$1"
  local temp_file
  temp_file="$(mktemp "${file_path}.tmp.XXXXXX")"
  jq --arg version "${VERSION}" '.version = $version' "${file_path}" > "${temp_file}"
  mv "${temp_file}" "${file_path}"
}

update_manifest_version package.json
update_manifest_version apps/desktop/package.json
update_manifest_version apps/desktop/src-tauri/tauri.conf.json

./scripts/verify-release-version.sh "v${VERSION}"

echo "release manifests updated to ${VERSION}"
