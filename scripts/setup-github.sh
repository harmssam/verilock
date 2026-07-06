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
NIMIQ_REPO="${LOGIN}/nimiq-seal"
VERILOCK_REPO="${LOGIN}/verilock"

ACTION="unknown"
if gh repo view "$NIMIQ_REPO" >/dev/null 2>&1; then
  if gh repo view "$VERILOCK_REPO" >/dev/null 2>&1; then
    echo "Both nimiq-seal and verilock exist on GitHub — linking to verilock."
    ACTION="exists"
  else
    echo "Renaming ${NIMIQ_REPO} → verilock..."
    gh repo rename verilock --repo "$NIMIQ_REPO" --yes
    ACTION="renamed"
  fi
elif gh repo view "$VERILOCK_REPO" >/dev/null 2>&1; then
  echo "verilock repo already exists."
  ACTION="exists"
else
  echo "Creating ${VERILOCK_REPO}..."
  gh repo create verilock --private --source=. --remote=origin --push=false
  ACTION="created"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${VERILOCK_REPO}.git"
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Rebrand to VeriLock"
fi

git push -u origin main

echo ""
echo "Action: ${ACTION}"
echo "Repo:   https://github.com/${VERILOCK_REPO}"
git remote -v