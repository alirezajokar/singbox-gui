#!/bin/sh
# Launcher installed as /usr/bin/singbox-gui.
#
# If the window stays blank on some NVIDIA/Wayland setups, try:
#   WEBKIT_DISABLE_DMABUF_RENDERER=1 singbox-gui
exec /opt/singbox-gui/singbox-gui "$@"
