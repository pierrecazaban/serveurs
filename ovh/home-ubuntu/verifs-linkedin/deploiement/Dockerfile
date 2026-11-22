# Vérification LinkedIn (étudiants / alumni) sur le VPS.
# Chromium dans un écran virtuel, visible par noVNC (tunnel SSH seulement), interface sur le port 8765.
FROM mcr.microsoft.com/playwright/python:v1.57.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox tzdata \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --break-system-packages --ignore-installed playwright==1.57.0 anthropic
ENV TZ=Europe/Paris DISPLAY=:99 VERIF_DATA=/data VERIF_HOTE=0.0.0.0 SMARTMAIL_DB=/smartmail/smartmail.db PYTHONUNBUFFERED=1
WORKDIR /app
COPY app.py page.html start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]
