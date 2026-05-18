#!/usr/bin/env bash
# Usage: ./sync.sh {pull|push|diff}
#
# Mirrors typo3/bib_pods with a remote SFTP location
#
# Setup:
#   1. brew install lftp
#   2. Create .syncdetails next to this script (gitignored) with:
#
#        SFTP_HOST=""
#        SFTP_PORT=""
#        SFTP_USER=""
#        SFTP_PASSWORD=""
#        SFTP_REMOTE_PATH=""

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DIR="$SCRIPT_DIR/bib_pods"
SFTP_FILE="$SCRIPT_DIR/.syncdetails"

if ! command -v lftp >/dev/null 2>&1; then
    echo "Error: lftp is required. Install with: brew install lftp" >&2
    exit 1
fi

if [[ ! -f "$SFTP_FILE" ]]; then
    echo "Error: $SFTP_FILE not found." >&2
    echo "See the setup instructions at the top of this script." >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$SFTP_FILE"

: "${SFTP_HOST:?SFTP_HOST not set in $SFTP_FILE}"
: "${SFTP_PORT:?SFTP_PORT not set in $SFTP_FILE}"
: "${SFTP_USER:?SFTP_USER not set in $SFTP_FILE}"
: "${SFTP_PASSWORD:?SFTP_PASSWORD not set in $SFTP_FILE}"
: "${SFTP_REMOTE_PATH:?SFTP_REMOTE_PATH not set in $SFTP_FILE}"

mkdir -p "$LOCAL_DIR"

run_lftp() {
    lftp -u "$SFTP_USER,$SFTP_PASSWORD" "sftp://$SFTP_HOST:$SFTP_PORT" <<EOF
set sftp:auto-confirm yes
set net:timeout 10
set net:max-retries 1
$1
bye
EOF
}

SYNCIGNORE_FILE="$SCRIPT_DIR/.syncignore"
EXCLUDES=""
RSYNC_EXCLUDES=()
if [[ -f "$SYNCIGNORE_FILE" ]]; then
    while IFS= read -r pattern || [[ -n "$pattern" ]]; do
        [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
        EXCLUDES+=" --exclude-glob $pattern"
        RSYNC_EXCLUDES+=("--exclude=$pattern")
    done < "$SYNCIGNORE_FILE"
fi
MIRROR_FLAGS="--verbose --delete$EXCLUDES"

case "${1:-}" in
    diff)
        LOCAL_TMP=$(mktemp -d)
        REMOTE_TMP=$(mktemp -d)
        trap 'rm -rf "$LOCAL_TMP" "$REMOTE_TMP"' EXIT
        echo "==> Fetching remote snapshot..."
        run_lftp "mirror$EXCLUDES \"$SFTP_REMOTE_PATH\" \"$REMOTE_TMP\""
        rsync -a "${RSYNC_EXCLUDES[@]}" "$LOCAL_DIR/" "$LOCAL_TMP/"
        echo "==> Diff (remote on the left, local on the right — '+' is what local adds):"
        git --no-pager diff --no-index --color=always "$REMOTE_TMP" "$LOCAL_TMP" \
            | sed -E "s|${LOCAL_TMP#/}|local|g; s|${REMOTE_TMP#/}|remote|g; /index [0-9a-f]+\.\.[0-9a-f]+/d" \
            | awk '
                /diff --git/ {
                    if (match($0, /(bundle|RefreshWorker)\.js/)) {
                        print "[" substr($0, RSTART, RLENGTH) ": content diff suppressed]"
                        skip = 1
                        next
                    }
                    skip = 0
                }
                !skip
            ' \
            || true
        ;;

    pull)
        echo "==> Pulling remote -> local (mirror with --delete)..."
        run_lftp "mirror $MIRROR_FLAGS \"$SFTP_REMOTE_PATH\" \"$LOCAL_DIR\""
        echo "==> Done."
        ;;

    push)
        echo "==> Pushing local -> remote (mirror with --delete)..."
        run_lftp "mirror -R $MIRROR_FLAGS \"$LOCAL_DIR\" \"$SFTP_REMOTE_PATH\""
        echo "==> Done."
        ;;

    *)
        cat <<HELP >&2
Usage: $0 {pull|push|diff}

  diff   Show what pull and push would change (read-only).
  pull   Mirror remote -> local. Overwrites local files; deletes locals not on remote.
  push   Mirror local -> remote. Overwrites remote files; deletes remotes not local.

SFTP connection details are read from: $SFTP_FILE
HELP
        exit 1
        ;;
esac
