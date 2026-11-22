# LinkedIn prospecting agent of The AI Certification, on the VPS.
# Two Chromes (one per LinkedIn account) in a virtual screen, viewable through noVNC (SSH tunnel only), and the agent's schedule.
FROM mcr.microsoft.com/playwright:v1.57.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox tzdata && rm -rf /var/lib/apt/lists/*
# Écran à distance net (22/11) : qualité d image maximale par défaut, et / ouvre directement l écran.
RUN sed -i "s/UI.initSetting('quality', 6);/UI.initSetting('quality', 9);/; s/UI.initSetting('compression', 2);/UI.initSetting('compression', 0);/" /usr/share/novnc/app/ui.js \
 && printf '<!doctype html><meta charset=utf-8><script>location.replace("vnc.html?autoconnect=1&reconnect=1&resize=scale&quality=9&compression=0")</script>' > /usr/share/novnc/index.html
ENV TZ=Europe/Paris DISPLAY=:99
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY agent.mjs lib.mjs notifier.mjs scheduler.mjs start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]
