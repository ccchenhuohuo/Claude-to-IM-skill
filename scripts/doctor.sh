#!/usr/bin/env bash
set -euo pipefail

CTI_HOME="${CTI_HOME:-$HOME/.claude-to-im}"
CONFIG_FILE="$CTI_HOME/config.env"
PID_FILE="$CTI_HOME/runtime/bridge.pid"
LOG_FILE="$CTI_HOME/logs/bridge.log"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo "[OK]   $label"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}

get_config() {
  local key="$1"
  grep "^${key}=" "$CONFIG_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'"'"']//;s/["'"'"']$//' || true
}

normalize_feishu_domain_url() {
  local raw="${1:-feishu}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  raw="${raw#http://}"
  raw="${raw#https://}"
  raw="${raw%%/*}"
  case "$raw" in
    lark|open.larksuite.com) printf '%s' "https://open.larksuite.com" ;;
    *) printf '%s' "https://open.feishu.cn" ;;
  esac
}

json_payload() {
  node -e 'process.stdout.write(JSON.stringify({ app_id: process.argv[1], app_secret: process.argv[2] }))' "$1" "$2"
}

echo "CTI_HOME: $CTI_HOME"

# --- Node.js version ---
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    check "Node.js >= 20 (found $(node -v))" 0
  else
    check "Node.js >= 20 (found $(node -v), need >= 20)" 1
  fi
else
  check "Node.js installed" 1
fi

# --- Config ---
if [ -f "$CONFIG_FILE" ]; then
  check "config.env exists" 0
else
  check "config.env exists ($CONFIG_FILE not found)" 1
fi

if [ -f "$CONFIG_FILE" ]; then
  PERMS=$(stat -c "%a" "$CONFIG_FILE" 2>/dev/null || stat -f "%Lp" "$CONFIG_FILE" 2>/dev/null || echo "unknown")
  if [ "$PERMS" = "600" ]; then
    check "config.env permissions are 600" 0
  else
    check "config.env permissions are 600 (currently $PERMS)" 1
  fi
fi

CTI_RUNTIME=$(get_config CTI_RUNTIME)
CTI_RUNTIME="${CTI_RUNTIME:-claude}"
echo "Runtime: $CTI_RUNTIME"
echo ""

# --- Claude CLI available (claude/auto modes) ---
if [ "$CTI_RUNTIME" = "claude" ] || [ "$CTI_RUNTIME" = "auto" ]; then
  CLAUDE_PATH=""
  CTI_EXE=$(get_config CTI_CLAUDE_CODE_EXECUTABLE 2>/dev/null || true)
  if [ -n "$CTI_EXE" ]; then
    CLAUDE_PATH="$CTI_EXE"
  else
    CLAUDE_PATH=$(command -v claude 2>/dev/null || true)
    if [ -z "$CLAUDE_PATH" ]; then
      for cand in \
        "$HOME/.claude/local/claude" \
        "$HOME/.local/bin/claude" \
        "/usr/local/bin/claude" \
        "/opt/homebrew/bin/claude" \
        "$HOME/.npm-global/bin/claude"; do
        if [ -x "$cand" ]; then CLAUDE_PATH="$cand"; break; fi
      done
    fi
  fi

  if [ -n "$CLAUDE_PATH" ] && [ -x "$CLAUDE_PATH" ]; then
    CLAUDE_VER=$("$CLAUDE_PATH" --version 2>/dev/null || echo "unknown")
    check "Claude CLI available (${CLAUDE_VER} at ${CLAUDE_PATH})" 0
  elif [ "$CTI_RUNTIME" = "claude" ]; then
    check "Claude CLI available (not found)" 1
  else
    check "Claude CLI available (not found — OK for auto mode if Codex is configured)" 0
  fi

  SDK_ENTRY=""
  for candidate in \
    "$SKILL_DIR/node_modules/@anthropic-ai/claude-agent-sdk/cli.js" \
    "$SKILL_DIR/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs" \
    "$SKILL_DIR/node_modules/@anthropic-ai/claude-agent-sdk/dist/cli.js"; do
    if [ -f "$candidate" ]; then SDK_ENTRY="$candidate"; break; fi
  done
  if [ -n "$SDK_ENTRY" ]; then
    check "Claude SDK package installed ($SDK_ENTRY)" 0
  elif [ "$CTI_RUNTIME" = "claude" ]; then
    check "Claude SDK package installed (not found — run 'npm install' in $SKILL_DIR)" 1
  else
    check "Claude SDK package installed (not found — OK for auto/codex mode)" 0
  fi
fi

# --- Codex checks (codex/auto modes) ---
if [ "$CTI_RUNTIME" = "codex" ] || [ "$CTI_RUNTIME" = "auto" ]; then
  if command -v codex &>/dev/null; then
    CODEX_VER=$(codex --version 2>/dev/null || echo "unknown")
    check "Codex CLI available (${CODEX_VER})" 0
  elif [ "$CTI_RUNTIME" = "codex" ]; then
    check "Codex CLI available (not found in PATH)" 1
  else
    check "Codex CLI available (not found — OK if Claude is configured)" 0
  fi

  CODEX_SDK="$SKILL_DIR/node_modules/@openai/codex-sdk"
  if [ -d "$CODEX_SDK" ]; then
    check "@openai/codex-sdk installed" 0
  elif [ "$CTI_RUNTIME" = "codex" ]; then
    check "@openai/codex-sdk installed (not found — run 'npm install' in $SKILL_DIR)" 1
  else
    check "@openai/codex-sdk installed (not found — OK for auto/claude mode)" 0
  fi
fi

# --- dist/daemon.mjs freshness ---
DAEMON_MJS="$SKILL_DIR/dist/daemon.mjs"
if [ -f "$DAEMON_MJS" ]; then
  STALE_SRC=""
  if [ -d "$SKILL_DIR/src" ]; then
    STALE_SRC=$(find "$SKILL_DIR/src" -name '*.ts' -newer "$DAEMON_MJS" 2>/dev/null | head -1)
  fi
  if [ -z "$STALE_SRC" ]; then
    check "dist/daemon.mjs is up to date" 0
  else
    check "dist/daemon.mjs is stale (src changed, run 'npm run build')" 1
  fi
else
  check "dist/daemon.mjs exists (not built — run 'npm run build')" 1
fi

# --- Feishu-only channel checks ---
if [ -f "$CONFIG_FILE" ]; then
  CTI_CHANNELS=$(get_config CTI_ENABLED_CHANNELS)
  if echo ",$CTI_CHANNELS," | grep -q ',feishu,'; then
    check "Feishu channel enabled" 0
  else
    check "Feishu channel enabled (set CTI_ENABLED_CHANNELS=feishu)" 1
  fi

  FS_APP_ID=$(get_config CTI_FEISHU_APP_ID)
  FS_SECRET=$(get_config CTI_FEISHU_APP_SECRET)
  FS_DOMAIN=$(normalize_feishu_domain_url "$(get_config CTI_FEISHU_DOMAIN)")

  if [ -n "$FS_APP_ID" ]; then check "Feishu app id configured" 0; else check "Feishu app id configured" 1; fi
  if [ -n "$FS_SECRET" ]; then check "Feishu app secret configured" 0; else check "Feishu app secret configured" 1; fi
  check "Feishu domain normalized (${FS_DOMAIN})" 0

  if [ "${CTI_DOCTOR_OFFLINE:-0}" = "1" ] || [ "${CTI_DOCTOR_NETWORK:-1}" = "0" ]; then
    check "Feishu credential network check skipped" 0
  elif [ -n "$FS_APP_ID" ] && [ -n "$FS_SECRET" ]; then
    FEISHU_PAYLOAD=$(json_payload "$FS_APP_ID" "$FS_SECRET")
    FEISHU_RESULT=$(curl -s --max-time 5 -X POST "${FS_DOMAIN}/open-apis/auth/v3/tenant_access_token/internal" \
      -H "Content-Type: application/json" \
      -d "$FEISHU_PAYLOAD" 2>/dev/null || echo '{"code":1}')
    if echo "$FEISHU_RESULT" | grep -q '"code"[[:space:]]*:[[:space:]]*0'; then
      check "Feishu app credentials are valid" 0
    else
      check "Feishu app credentials are valid (token request failed)" 1
    fi
  fi
fi

# --- Directory checks ---
for dir in "$CTI_HOME/logs" "$CTI_HOME/runtime" "$CTI_HOME/data"; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then
    check "Directory is writable ($dir)" 0
  else
    check "Directory is writable ($dir)" 1
  fi
done

LARK_DIR="$CTI_HOME/lark"
if [ ! -e "$LARK_DIR" ]; then
  check "lark workspace root (not yet created)" 0
elif [ -d "$LARK_DIR" ] && [ -w "$LARK_DIR" ]; then
  check "lark workspace root is writable" 0
else
  check "lark workspace root is writable ($LARK_DIR)" 1
fi

# --- PID file consistency ---
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    check "PID file consistent (process $PID is running)" 0
  else
    check "PID file consistent (stale PID $PID, process not running)" 1
  fi
else
  check "PID file consistency (no PID file, OK)" 0
fi

# --- Recent errors in log ---
if [ -f "$LOG_FILE" ]; then
  ERROR_COUNT=$(tail -50 "$LOG_FILE" | grep -ciE 'ERROR|Fatal' || true)
  if [ "$ERROR_COUNT" -eq 0 ]; then
    check "No recent errors in log (last 50 lines)" 0
  else
    check "No recent errors in log (found $ERROR_COUNT ERROR/Fatal lines)" 1
  fi
else
  check "Log file exists (not yet created)" 0
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Common fixes:"
  echo "  SDK package missing   → cd $SKILL_DIR && npm install"
  echo "  dist/daemon.mjs stale → cd $SKILL_DIR && npm run build"
  echo "  config.env missing    → run setup wizard"
  echo "  Feishu config missing → set CTI_ENABLED_CHANNELS=feishu, CTI_FEISHU_APP_ID, CTI_FEISHU_APP_SECRET"
  echo "  Stale PID file        → run stop, then start"
fi

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
