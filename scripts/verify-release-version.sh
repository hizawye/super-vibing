#!/usr/bin/env bash

set -euo pipefail

ARG_ONE="${1:-}"
if [[ "${ARG_ONE}" == "--" ]]; then
  shift || true
fi

TAG_NAME="${GITHUB_REF_NAME:-${1:-}}"
if [[ -z "${TAG_NAME}" ]]; then
  echo "release tag is required (expected GITHUB_REF_NAME like v0.1.3)" >&2
  exit 1
fi

if [[ ! "${TAG_NAME}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid release tag '${TAG_NAME}' (expected format vX.Y.Z)" >&2
  echo "hint: run 'pnpm run release:prepare -- ${TAG_NAME#v}' before tagging" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to verify release version parity" >&2
  exit 1
fi

read_version() {
  local file_path="$1"
  local version
  version="$(jq -r '.version // empty' "${file_path}")"
  if [[ -z "${version}" ]]; then
    echo "${file_path} is missing a version" >&2
    exit 1
  fi
  printf "%s" "${version}"
}

ROOT_VERSION="$(read_version package.json)"
DESKTOP_VERSION="$(read_version apps/desktop/package.json)"
TAURI_VERSION="$(read_version apps/desktop/src-tauri/tauri.conf.json)"

if [[ "${ROOT_VERSION}" != "${DESKTOP_VERSION}" || "${ROOT_VERSION}" != "${TAURI_VERSION}" ]]; then
  echo "release version mismatch across manifests" >&2
  echo "detected versions: root='${ROOT_VERSION}', desktop='${DESKTOP_VERSION}', tauri='${TAURI_VERSION}'" >&2
  echo "hint: run 'pnpm run release:prepare -- ${TAG_NAME#v}'" >&2
  exit 1
fi

EXPECTED_TAG="v${ROOT_VERSION}"
if [[ "${TAG_NAME}" != "${EXPECTED_TAG}" ]]; then
  echo "release tag/version mismatch: tag='${TAG_NAME}', expected='${EXPECTED_TAG}'" >&2
  echo "detected versions: root='${ROOT_VERSION}', desktop='${DESKTOP_VERSION}', tauri='${TAURI_VERSION}'" >&2
  echo "hint: run 'pnpm run release:prepare -- ${TAG_NAME#v}'" >&2
  exit 1
fi

echo "release version parity verified: ${TAG_NAME} (root=${ROOT_VERSION}, desktop=${DESKTOP_VERSION}, tauri=${TAURI_VERSION})"
