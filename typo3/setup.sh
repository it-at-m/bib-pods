#!/usr/bin/env bash
# TYPO3 local installation using DDEV: https://docs.typo3.org/m/typo3/tutorial-getting-started/13.4/en-us/Installation/Install.html
# Dependencies: Docker Desktop, DDEV

set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")" && pwd)/site"

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
