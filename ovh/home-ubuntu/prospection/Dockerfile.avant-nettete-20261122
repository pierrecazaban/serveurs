# LinkedIn prospecting agent of The AI Certification, on the VPS.
# Two Chromes (one per LinkedIn account) in a virtual screen, viewable through noVNC (SSH tunnel only), and the agent's schedule.
FROM mcr.microsoft.com/playwright:v1.57.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox tzdata && rm -rf /var/lib/apt/lists/*
ENV TZ=Europe/Paris DISPLAY=:99
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY agent.mjs lib.mjs notifier.mjs scheduler.mjs start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]
