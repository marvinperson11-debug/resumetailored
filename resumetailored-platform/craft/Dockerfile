# Craft sidecar (PdfCraft / WordCraft / GridCraft CLIs behind a tiny Node HTTP wrapper) for Railway.
# A SECOND Railway service: its root directory is resumetailored-platform/craft, so this file and the build
# context are both relative to that folder. Never add these binaries to the main app image.

# ── stage 1: download every pinned tool and verify its SHA-256 (the build FAILS on any mismatch) ──
FROM node:20-bookworm-slim AS tools
WORKDIR /build
COPY versions.lock install-tools.cjs ./
RUN node install-tools.cjs --lock versions.lock --dest /opt/craft

# ── stage 2: runtime ──
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    CRAFT_HOME=/opt/craft \
    CRAFT_TMP=/tmp/craft \
    PORT=8080
# The same faces as the app image (Carlito is metric-compatible with Calibri), so a WordCraft render and the
# LibreOffice render the benchmark compares it with have the same fonts available.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-crosextra-carlito fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
# Binaries + versions.lock + each tool's upstream LICENSE/NOTICE/OFL files (/opt/craft/licenses/<tool>/).
COPY --from=tools /opt/craft /opt/craft
WORKDIR /srv/craft
COPY server.cjs util.cjs ./
# Per-request temp dirs live here (mount a tmpfs on it where the platform allows; docker-compose.yml does).
RUN mkdir -p /tmp/craft && chown node:node /tmp/craft
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
