#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-doomscroller.service}"
# Space-delimited list of tracked files that runtime is allowed to mutate.
MUTABLE_FILES="${MUTABLE_FILES:-data/studies_cache.json}"

cd "${REPO_DIR}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: ${REPO_DIR}" >&2
  exit 1
fi

git fetch "${REMOTE}" "${BRANCH}"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "${REMOTE}/${BRANCH}")"

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  echo "No new commits."
  exit 0
fi

echo "Updating ${LOCAL_SHA:0:7}..${REMOTE_SHA:0:7}"

for file_path in ${MUTABLE_FILES}; do
  if git ls-files --error-unmatch "${file_path}" >/dev/null 2>&1; then
    # Avoid pull failures from runtime writes to tracked cache files.
    git restore --staged --worktree "${file_path}" || true
  fi
done

git pull --ff-only "${REMOTE}" "${BRANCH}"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl restart "${SERVICE_NAME}"; then
    echo "Restarted ${SERVICE_NAME}"
  else
    echo "Warning: failed to restart ${SERVICE_NAME}" >&2
  fi
fi

echo "Updated to $(git rev-parse --short HEAD)"
