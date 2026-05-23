#!/usr/bin/env bash
# Usage: ./repo.sh {install|build|clean}
#
# Operates on the npm packages in this repo:
#   cori-sdk, bib-src, docs, typo3/bib_pods, api, solid-server, interim-index

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKGS=(cori-sdk bib-src docs typo3/bib_pods api solid-server interim-index)

case "${1:-}" in
    install)
        for pkg in "${PKGS[@]}"; do
            echo "==> npm install in $pkg"
            (cd "$SCRIPT_DIR/$pkg" && npm install)
        done
        ;;
    build)
        for pkg in "${PKGS[@]}"; do
            echo "==> npm run ttl-to-js --if-present in $pkg"
            (cd "$SCRIPT_DIR/$pkg" && npm run ttl-to-js --if-present)
        done
        for pkg in "${PKGS[@]}"; do
            echo "==> npm run build --if-present in $pkg"
            (cd "$SCRIPT_DIR/$pkg" && npm run build --if-present)
        done
        ;;
    clean)
        for pkg in "${PKGS[@]}"; do
            echo "==> removing node_modules and package-lock.json in $pkg"
            rm -rf "$SCRIPT_DIR/$pkg/node_modules" "$SCRIPT_DIR/$pkg/package-lock.json"
        done
        echo "==> removing generated *.ttl.js files"
        find "$SCRIPT_DIR" -name node_modules -prune -o -name '*.ttl.js' -delete
        ;;
    *)
        cat <<HELP >&2
Usage: $0 {install|build|clean}

  install  Run 'npm install' in each package (cori-sdk, bib-src, docs, typo3/bib_pods, solid-server, interim-index).
  build    Run 'npm run build --if-present' in each package; pkgs without a build script no-op.
  clean    Delete node_modules and package-lock.json in each package.
HELP
        exit 1
        ;;
esac
