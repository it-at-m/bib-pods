#!/usr/bin/env bash
# Manage the local TYPO3 DDEV instance
# Usage: ./script.sh {setup|start|stop}
#
# If the Solid server was restarted and you get a stale client
# error, clear the browser storage for the DDEV site:
# chrome://settings/content/all?searchSubpage=ddev&search=view+per
#
# ddev typo3 cache:flush

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR/site"

site_url() {
    echo "https://$(ddev exec printenv DDEV_HOSTNAME):$(ddev exec printenv DDEV_ROUTER_HTTPS_PORT)"
}

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
    SITE_URL=$(site_url)
    rm -f .gitignore  # ddev start creates this, but composer create-project requires a clean directory

    echo "==> Installing TYPO3 via Composer..."
    ddev composer create-project typo3/cms-base-distribution

    echo "==> Mounting bib-pods-ext into DDEV container..."
    cat > "$SITE_DIR/.ddev/docker-compose.bib-pods-ext.yaml" <<DDEV
services:
  web:
    volumes:
      - $SCRIPT_DIR/bib-pods-ext:/var/www/html/bib-pods-ext:rw
DDEV
    ddev restart

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

    echo "==> Installing bib-pods-ext..."
    ddev composer config repositories.bib-pods-ext path bib-pods-ext
    ddev composer require bib-pods/typo3-ext:@dev

    echo "==> Activating bib-pods-ext set..."
    cat > "$SITE_DIR/config/sites/main/config.yaml" <<YAML
base: '$SITE_URL'
dependencies:
  - bib-pods/typo3-ext
errorHandling: {  }
languages:
  -
    title: English
    enabled: true
    languageId: 0
    base: /
    locale: en_US.UTF-8
    navigationTitle: English
    flag: us
rootPageId: 1
routes: {  }
YAML

    echo "==> Removing default TypoScript overrides..."
    echo "DELETE FROM sys_template;" | ddev mysql
    rm -f "$SITE_DIR/config/sites/main/setup.typoscript"

    echo "==> Flushing TYPO3 caches..."
    ddev typo3 cache:flush

    echo "==> Done. Opening TYPO3 frontend and backend..."
    ddev launch "$SITE_URL"
    ddev launch "$SITE_URL/typo3/"
    ;;

  start)
    cd "$SITE_DIR"
    ddev start
    echo "==> TYPO3 is running."
    SITE_URL=$(site_url)
    ddev launch "$SITE_URL"
    ddev launch "$SITE_URL/typo3/"
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
