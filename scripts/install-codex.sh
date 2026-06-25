#!/usr/bin/env bash
set -euo pipefail

# Install claude-to-im skill for Codex.
# Usage: bash scripts/install-codex.sh [--link]
#   --link  Create a symlink instead of copying (for development)

SKILL_NAME="claude-to-im"
CODEX_SKILLS_DIR="$HOME/.codex/skills"
TARGET_DIR="$CODEX_SKILLS_DIR/$SKILL_NAME"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DEP_NAME="Claude-to-IM"
CORE_TARGET_DIR="$CODEX_SKILLS_DIR/$CORE_DEP_NAME"
CORE_SOURCE_DIR="$(cd "$SOURCE_DIR/../$CORE_DEP_NAME" 2>/dev/null && pwd || true)"

echo "Installing $SKILL_NAME skill for Codex..."

# Check source
if [ ! -f "$SOURCE_DIR/SKILL.md" ]; then
  echo "Error: SKILL.md not found in $SOURCE_DIR"
  exit 1
fi

# Create skills directory
mkdir -p "$CODEX_SKILLS_DIR"

# Check if already installed
if [ -e "$TARGET_DIR" ]; then
  if [ -L "$TARGET_DIR" ]; then
    EXISTING=$(readlink "$TARGET_DIR")
    echo "Already installed as symlink → $EXISTING"
    echo "To reinstall, remove it first: rm $TARGET_DIR"
    exit 0
  else
    echo "Already installed at $TARGET_DIR"
    echo "To reinstall, remove it first: rm -rf $TARGET_DIR"
    exit 0
  fi
fi

if [ "${1:-}" = "--link" ]; then
  ln -s "$SOURCE_DIR" "$TARGET_DIR"
  echo "Symlinked: $TARGET_DIR → $SOURCE_DIR"
else
  cp -R "$SOURCE_DIR" "$TARGET_DIR"
  echo "Copied to: $TARGET_DIR"
fi

# The skill package depends on claude-to-im via file:../Claude-to-IM.
# Prepare that sibling dependency for both copied installs and --link installs.
if [ ! -e "$CORE_TARGET_DIR/package.json" ]; then
  if [ -n "$CORE_SOURCE_DIR" ] && [ -f "$CORE_SOURCE_DIR/package.json" ]; then
    if [ "${1:-}" = "--link" ]; then
      ln -s "$CORE_SOURCE_DIR" "$CORE_TARGET_DIR"
      echo "Symlinked dependency: $CORE_TARGET_DIR → $CORE_SOURCE_DIR"
    else
      cp -R "$CORE_SOURCE_DIR" "$CORE_TARGET_DIR"
      echo "Copied dependency to: $CORE_TARGET_DIR"
    fi
  elif command -v git >/dev/null 2>&1; then
    echo "Cloning claude-to-im dependency..."
    git clone https://github.com/op7418/Claude-to-IM.git "$CORE_TARGET_DIR"
  else
    echo "Error: missing sibling dependency $CORE_TARGET_DIR and git is not available."
    echo "Clone https://github.com/op7418/Claude-to-IM.git to $CORE_TARGET_DIR, then rerun this script."
    exit 1
  fi
fi

# Ensure dependencies (need devDependencies for build step)
if [ ! -d "$TARGET_DIR/node_modules" ] || [ ! -d "$TARGET_DIR/node_modules/@openai/codex-sdk" ]; then
  echo "Installing dependencies..."
  (cd "$TARGET_DIR" && npm install)
fi

# Ensure build
if [ ! -f "$TARGET_DIR/dist/daemon.mjs" ]; then
  echo "Building daemon bundle..."
  (cd "$TARGET_DIR" && npm run build)
fi

# Prune devDependencies after build
echo "Pruning dev dependencies..."
(cd "$TARGET_DIR" && npm prune --production)

echo ""
echo "Done! Start a new Codex session and use:"
echo "  claude-to-im setup    — configure IM platform credentials"
echo "  claude-to-im start    — start the bridge daemon"
echo "  claude-to-im doctor   — diagnose issues"
