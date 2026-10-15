#!/usr/bin/env bash
# Package ./dist into a .deb  ->  dist/singbox-gui_<version>_<arch>.deb
# Run scripts/build.sh first. Needs: dpkg-deb, node (to read the version).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -x dist/singbox-gui ] && [ -x dist/launcher ] || { echo "dist/ is empty: run scripts/build.sh first" >&2; exit 1; }

VERSION="${VERSION:-$(node -p "require('./tinyjs.json').version")}"
case "${ARCH:-$(dpkg --print-architecture)}" in
  amd64 | x86_64) ARCH=amd64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) echo "unsupported architecture" >&2; exit 1 ;;
esac
ID="io.github.alirezajokar.singbox-gui"
PKG="singbox-gui_${VERSION}_${ARCH}"
ROOT="build/deb/${PKG}"

rm -rf "$ROOT"
install -d "$ROOT/DEBIAN" "$ROOT/opt/singbox-gui" "$ROOT/usr/bin" "$ROOT/usr/lib/singbox-gui" \
  "$ROOT/usr/share/applications" "$ROOT/usr/share/polkit-1/actions" \
  "$ROOT/usr/share/icons/hicolor/512x512/apps" "$ROOT/usr/share/icons/hicolor/scalable/apps" \
  "$ROOT/usr/share/doc/singbox-gui"

# the app itself
install -m 0755 dist/singbox-gui "$ROOT/opt/singbox-gui/singbox-gui"
install -m 0755 dist/launcher "$ROOT/opt/singbox-gui/launcher"
install -m 0644 dist/icon.png "$ROOT/opt/singbox-gui/icon.png"
[ -d dist/resources ] && cp -r dist/resources "$ROOT/opt/singbox-gui/resources"
[ -d dist/executables ] && cp -r dist/executables "$ROOT/opt/singbox-gui/executables"

# integration
install -m 0755 packaging/singbox-gui.sh "$ROOT/usr/bin/singbox-gui"
install -m 0755 packaging/singbox-gui-helper "$ROOT/usr/lib/singbox-gui/helper"
install -m 0644 packaging/app.singboxgui.policy "$ROOT/usr/share/polkit-1/actions/app.singboxgui.policy"
install -m 0644 "packaging/${ID}.desktop" "$ROOT/usr/share/applications/${ID}.desktop"
install -m 0644 assets/icon.png "$ROOT/usr/share/icons/hicolor/512x512/apps/singbox-gui.png"
install -m 0644 packaging/icon.svg "$ROOT/usr/share/icons/hicolor/scalable/apps/singbox-gui.svg"
install -m 0644 LICENSE "$ROOT/usr/share/doc/singbox-gui/copyright"
install -m 0644 README.md "$ROOT/usr/share/doc/singbox-gui/README.md"
install -m 0755 packaging/postinst "$ROOT/DEBIAN/postinst"
install -m 0755 packaging/postrm "$ROOT/DEBIAN/postrm"

SIZE="$(du -sk "$ROOT" | cut -f1)"
cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: singbox-gui
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Installed-Size: ${SIZE}
Maintainer: Alireza Jokar <alirezajokar@users.noreply.github.com>
Homepage: https://github.com/alirezajokar/singbox-gui
Depends: libc6 (>= 2.35), libstdc++6, libffi8, libx11-6, libxtst6, libgtk-3-0t64 | libgtk-3-0, libwebkit2gtk-4.1-0, libayatana-appindicator3-1, libpipewire-0.3-0t64 | libpipewire-0.3-0, pkexec | policykit-1, systemd
Recommends: fonts-vazirmatn | fonts-noto-core
Suggests: sing-box
Description: Simple desktop manager for the sing-box proxy service
 Singbox GUI turns, and keeps, a sing-box configuration manageable without
 editing JSON by hand: switch the service on and off, build routing rules
 (domains, TLDs, IPs, rule-sets), define DNS servers, import share links and
 follow the logs. Built with TinyJS (txiki.js + the system WebKitGTK).
CONTROL

mkdir -p dist
dpkg-deb --root-owner-group -Zxz --build "$ROOT" "dist/${PKG}.deb" >/dev/null
echo "dist/${PKG}.deb"
dpkg-deb --info "dist/${PKG}.deb" | sed -n '1,14p'
