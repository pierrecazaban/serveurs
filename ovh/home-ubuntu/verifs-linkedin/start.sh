#!/bin/sh
# Mode pilote (VERIF_CDP) : on se sert du Chrome de la prospection, pas besoin d'écran virtuel.
if [ -z "$VERIF_CDP" ]; then
  Xvfb :99 -screen 0 1440x900x24 &
  sleep 1
  fluxbox >/dev/null 2>&1 &
  x11vnc -display :99 -forever -shared -nopw -rfbport 5901 -localhost -quiet &
  websockify --web /usr/share/novnc 6081 localhost:5901 >/dev/null 2>&1 &
  export VERIF_CHROME=$(python -c "from playwright.sync_api import sync_playwright as s; p=s().start(); print(p.chromium.executable_path); p.stop()")
fi
exec python app.py
