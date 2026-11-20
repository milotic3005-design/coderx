#!/bin/bash
# Monthly payer site-of-care refresh from an operator's Mac: reads UnitedHealthcare, Premera, Regence, Aetna,
# Cigna and Anthem site-of-care policies and drug lists and uploads them for /tools/soc-check
# (see docs/05-operations.md). Notifies when a list or the criteria wording changed.
#
#   scripts/soc-policies-launchd.sh install     write and load ~/Library/LaunchAgents/com.coderx.soc-policies-refresh.plist
#   scripts/soc-policies-launchd.sh status      launchd state and the last log lines
#   scripts/soc-policies-launchd.sh run [args]  what launchd runs (args go to refresh-soc-policies.ts, e.g. --dry-run, --only uhc,premera)
#   scripts/soc-policies-launchd.sh uninstall   unload and remove the job
#
# install reads CODERX_BASE_URL (default https://coderxnsl.vercel.app) and CODERX_NODE (default
# /usr/local/bin/node, else the node on PATH) and bakes them into the job. The admin token is read at
# run time from .env.production.local in this checkout; it is never copied into the plist or logged.
set -euo pipefail

LABEL=com.coderx.soc-policies-refresh
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/coderx-soc-policies-refresh.log"
DOMAIN="gui/$(id -u)"

notify_failure() {
  osascript -e "display notification \"$1\" with title \"CodeRx site-of-care refresh failed\"" >/dev/null 2>&1 || true
}

cmd_run() {
  local base="${CODERX_BASE_URL:-https://coderxnsl.vercel.app}"
  local node="${CODERX_NODE:-$(command -v node || true)}"
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) soc-policies refresh → $base"
  if [[ ! -x "$node" ]]; then
    echo "soc-policies: failed — no node binary (set CODERX_NODE and re-run install)."
    notify_failure "No node binary. See $LOG"
    return 1
  fi
  export PATH="$(dirname "$node"):/usr/bin:/bin"
  cd "$REPO"
  if [[ ! -f scripts/refresh-soc-policies.ts ]]; then
    echo "soc-policies: failed — $REPO has no scripts/refresh-soc-policies.ts checked out."
    notify_failure "The checked-out branch has no refresh script. See $LOG"
    return 1
  fi
  # The job can fire right after wake, before the network is up: wait up to 10 minutes.
  local i
  for i in $(seq 1 20); do
    curl -sfo /dev/null -m 10 "$base/api/health" && break
    sleep 30
  done
  local token
  token="$(sed -n 's/^CODERX_ADMIN_TOKEN=//p' .env.production.local 2>/dev/null | tail -n 1 || true)"
  token="${token%\"}"; token="${token#\"}"; token="${token%\'}"; token="${token#\'}"
  if [[ -z "$token" ]]; then
    echo "soc-policies: failed — CODERX_ADMIN_TOKEN not found in $REPO/.env.production.local."
    notify_failure "Admin token not found. See $LOG"
    return 1
  fi
  local out
  out="$(mktemp)"
  if ! CODERX_ADMIN_TOKEN="$token" npm run -s refresh:soc-policies -- --base-url "$base" "$@" 2>&1 | tee "$out"; then
    notify_failure "See $LOG"
    rm -f "$out"
    return 1
  fi
  # Tell the operator when something changed, not only when the run failed.
  local review changed
  review="$(grep -c "REVIEW NEEDED" "$out" || true)"
  changed="$(grep -c "CHANGED" "$out" || true)"
  rm -f "$out"
  if [[ "$review" != "0" || "$changed" != "0" ]]; then
    osascript -e "display notification \"$changed list change(s), $review wording change(s) to review. See /tools/soc-check\" with title \"CodeRx site-of-care policies changed\"" >/dev/null 2>&1 || true
  fi
}

cmd_install() {
  local base="${CODERX_BASE_URL:-https://coderxnsl.vercel.app}"
  local node="${CODERX_NODE:-}"
  if [[ -z "$node" ]]; then
    if [[ -x /usr/local/bin/node ]]; then node=/usr/local/bin/node; else node="$(command -v node || true)"; fi
  fi
  [[ -x "$node" ]] || { echo "No node binary found; set CODERX_NODE." >&2; exit 1; }
  [[ -d "$REPO/node_modules" ]] || { echo "Run npm ci in $REPO first." >&2; exit 1; }
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/soc-policies-launchd.sh</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODERX_BASE_URL</key><string>$base</string>
    <key>CODERX_NODE</key><string>$node</string>
  </dict>
  <!-- The 2nd of each month, 07:00 local time (payers post monthly updates on the 1st); a run missed while asleep happens at the next wake. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Day</key><integer>2</integer>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  plutil -lint -s "$PLIST"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "Installed $LABEL: the 2nd of each month, 07:00 local → $base (node $node). Log: $LOG"
}

cmd_uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
}

cmd_status() {
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^\s*(state|runs|last exit code|program) =' || echo "$LABEL is not loaded."
  [[ -f "$LOG" ]] && { echo "--- $LOG"; tail -n 15 "$LOG"; }
  return 0
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
