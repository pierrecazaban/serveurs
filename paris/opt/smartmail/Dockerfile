FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# Chromium et ses bibliothèques : le serveur se connecte à Outlook web comme un navigateur.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Chromium complet (pas seulement la version allégée) : il charge l'extension Smart Mail.
RUN .venv/bin/playwright install --with-deps chromium \
 && apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-color-emoji fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/*
# Polices : la page de connexion Microsoft montrée en direct doit avoir son vrai visage.
COPY deploiement/polices/99-segoe.conf /etc/fonts/conf.d/99-segoe.conf
RUN fc-cache -f >/dev/null
COPY app ./app
# L'extension Smart Mail : le serveur la fait tourner dans Outlook pour relever et envoyer.
COPY extension ./extension
ENV SMARTMAIL_EXTENSION=/app/extension
ENV SMARTMAIL_BASE=/data/smartmail.db PATH="/app/.venv/bin:$PATH"
VOLUME ["/data"]
EXPOSE 8000
# Un seul processus : les connexions Outlook en cours (validation sur le téléphone) vivent en mémoire.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "15"]
