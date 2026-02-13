#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift || true
fi

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "release version is required (example: 0.1.13)" >&2
  exit 1
fi

if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid release version '${VERSION}' (expected format X.Y.Z)" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to create release tags" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "must be run inside a git repository" >&2
  exit 1
fi

if ! git diff --quiet --ignore-submodules --; then
  echo "working tree must be clean before creating a release tag" >&2
  git status --short >&2
  exit 1
fi

if ! git diff --cached --quiet --ignore-submodules --; then
  echo "staged changes must be committed before creating a release tag" >&2
  git status --short >&2
  exit 1
fi

TAG_NAME="v${VERSION}"
if git rev-parse -q --verify "refs/tags/${TAG_NAME}" >/dev/null; then
  echo "local tag '${TAG_NAME}' already exists" >&2
  exit 1
fi

if git ls-remote --tags origin "refs/tags/${TAG_NAME}" | grep -q .; then
  echo "remote tag '${TAG_NAME}' already exists on origin" >&2
  exit 1
fi

pnpm run release:prepare -- "${VERSION}"

if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
  echo "release manifests changed for ${VERSION}; commit them before tagging" >&2
  git status --short package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json >&2
  echo "hint: git add package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json" >&2
  echo "hint: git commit -m \"chore(release): bump version parity to ${VERSION}\"" >&2
  exit 1
fi

pnpm run release:verify -- "${TAG_NAME}"
git tag -a "${TAG_NAME}" -m "release ${TAG_NAME}"

echo "created tag ${TAG_NAME} on commit $(git rev-parse --short HEAD)"
echo "next: git push origin ${TAG_NAME}"
