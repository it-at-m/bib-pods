#!/usr/bin/env bash
# Manage the local TYPO3 DDEV instance
# Usage: ./script.sh {setup|start|stop}

set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")" && pwd)/site"

case "${1:-}" in
  setup)
    echo "==> Removing any existing DDEV project and database..."
    ddev delete --omit-snapshot -y site || true

    echo "==> Removing existing site files..."
    rm -rf "$SITE_DIR"
    mkdir -p "$SITE_DIR"
    cd "$SITE_DIR"

    echo "==> Configuring DDEV project..."
    ddev config \
      --project-type typo3 \
      --docroot public

    echo "==> Starting DDEV..."
    ddev start
    SITE_URL=$(ddev exec printenv DDEV_PRIMARY_URL)
    rm -f .gitignore  # ddev start creates this, but composer create-project requires a clean directory

    echo "==> Installing TYPO3 via Composer..."
    ddev composer create-project typo3/cms-base-distribution

    echo "==> Resetting database..."
    echo "DROP DATABASE IF EXISTS \`db\`; CREATE DATABASE \`db\`;" | ddev mysql

    echo "==> Setting up TYPO3..."
    ddev typo3 setup \
      --server-type=other \
      --driver=mysqli \
      --host=db \
      --port=3306 \
      --dbname=db \
      --username=db \
      --password=db \
      --admin-username=admin \
      --admin-user-password=Admin1234! \
      --project-name=typo3-local \
      --create-site="$SITE_URL" \
      --no-interaction

    echo "==> Done. Opening TYPO3 frontend and backend..."
    ddev launch
    ddev launch /typo3/
    ;;

  start)
    cd "$SITE_DIR"
    ddev start
    echo "==> TYPO3 is running."
    ddev launch
    ddev launch /typo3/
    ;;

  stop)
    cd "$SITE_DIR"
    ddev stop
    echo "==> TYPO3 has been stopped."
    ;;

  *)
    echo "Usage: $0 {setup|start|stop}" >&2
    exit 1
    ;;
esac
