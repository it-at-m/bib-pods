#!/usr/bin/env bash
# Usage: ./script.sh {setup|start|stop|flush}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR/site"
EXT_DIR="$SCRIPT_DIR/bib_pods"
EXT_KEY="bib_pods"
TYPO3_VERSION="13"

TYPO3_BIN="/var/www/html/typo3/sysext/core/bin/typo3"

site_url() {
    echo "https://$(ddev exec printenv DDEV_HOSTNAME):$(ddev exec printenv DDEV_ROUTER_HTTPS_PORT)"
}

typo3() {
    ddev exec "$TYPO3_BIN" "$@"
}

case "${1:-}" in
  setup)
    echo "==> Removing any existing DDEV project and database..."
    ddev delete --omit-snapshot -y site || true

    echo "==> Removing existing site files..."
    rm -rf "$SITE_DIR"
    mkdir -p "$SITE_DIR"
    cd "$SITE_DIR"

    echo "==> Downloading TYPO3 $TYPO3_VERSION source tarball..."
    curl -fsSL "https://get.typo3.org/$TYPO3_VERSION" -o typo3.tar.gz
    tar -xzf typo3.tar.gz --strip-components=1
    rm typo3.tar.gz

    echo "==> Setting up classical install structure..."
    mkdir -p typo3conf/ext typo3temp fileadmin
    touch FIRST_INSTALL

    echo "==> Configuring DDEV project..."
    ddev config \
      --project-type=typo3 \
      --docroot=

    echo "==> Mounting bib-pods into DDEV container..."
    cat > "$SITE_DIR/.ddev/docker-compose.bib-pods.yaml" <<DDEV
services:
  web:
    volumes:
      - $EXT_DIR:/var/www/html/typo3conf/ext/$EXT_KEY:rw
DDEV

    echo "==> Starting DDEV..."
    ddev start
    SITE_URL=$(site_url)

    echo "==> Resetting database..."
    echo "DROP DATABASE IF EXISTS \`db\`; CREATE DATABASE \`db\`;" | ddev mysql

    echo "==> Setting up TYPO3..."
    typo3 setup \
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

    echo "==> Registering bib_pods in PackageStates..."
    cat > "$SITE_DIR/_register.php" <<'PHP'
<?php
$file = '/var/www/html/typo3conf/PackageStates.php';
$states = include $file;
$states['packages']['bib_pods'] = ['packagePath' => 'typo3conf/ext/bib_pods/'];
ksort($states['packages']);
file_put_contents($file, "<?php\n# PackageStates.php\n\nreturn " . var_export($states, true) . ";\n");
PHP
    ddev exec php /var/www/html/_register.php
    rm "$SITE_DIR/_register.php"

    echo "==> Updating class loading info..."
    typo3 dumpautoload

    echo "==> Activating bib-pods extension..."
    typo3 extension:setup -e bib_pods

    echo "==> Configuring site to use the bib-pods site set..."
    site_config="$SITE_DIR/typo3conf/sites/main/config.yaml"
    mkdir -p "$(dirname "$site_config")"
    cat > "$site_config" <<YAML
base: '$SITE_URL'
rootPageId: 1
dependencies:
  - bib-pods/site
languages:
  -
    title: Deutsch
    enabled: true
    languageId: 0
    base: /
    locale: de_DE.UTF-8
YAML

    echo "==> Removing default sys_template..."
    echo "DELETE FROM sys_template;" | ddev mysql

    echo "==> Seeding bib-pods plugin content element on root page..."
    echo "INSERT INTO tt_content (pid, CType, colPos, header) VALUES (1, 'bibpods_pod', 0, 'bib-pods');" | ddev mysql

    echo "==> Flushing TYPO3 caches..."
    typo3 cache:flush

    echo "==> Done. Opening TYPO3 frontend and backend..."
    ddev launch "$SITE_URL"
    ddev launch "$SITE_URL/typo3/"
    ;;

  start)
    cd "$SITE_DIR"
    ddev start
    SITE_URL=$(site_url)
    echo "==> TYPO3 is running."
    ddev launch "$SITE_URL"
    ddev launch "$SITE_URL/typo3/"
    ;;

  stop)
    cd "$SITE_DIR"
    ddev stop
    echo "==> TYPO3 has been stopped."
    ;;

  flush)
    cd "$SITE_DIR"
    typo3 cache:flush
    ;;

  *)
    echo "Usage: $0 {setup|start|stop|flush}" >&2
    exit 1
    ;;
esac
