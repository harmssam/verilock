#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install: brew install gh" >&2
  exit 1
fi

gh auth status

if [ ! -d .git ]; then
  git init
  git branch -M main
fi

LOGIN="$(gh api user -q .login)"
REPO="${LOGIN}/verilock"

ACTION="unknown"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "verilock repo already exists."
  ACTION="exists"
else
  echo "Creating ${REPO}..."
  gh repo create verilock --public --source=. --remote=origin --push=false
  ACTION="created"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${REPO}.git"
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Prepare VeriLock for public release"
fi

git push -u origin main

echo ""
echo "Action: ${ACTION}"
echo "Repo:   https://github.com/${REPO}"
git remote -v