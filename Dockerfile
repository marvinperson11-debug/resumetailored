# Debian-based image for Railway. Replaces the Nixpacks build because Remotion's
# server-side renderer needs a prebuilt Chrome (chrome-headless-shell) that does
# not run on Nixpacks' non-standard library paths (it failed to launch with
# "Closed with 127"). On Debian the shell runs once its shared libraries are
# apt-installed. Everything the old nixpacks.toml provided is mirrored here:
# Node, build tools, Chrome's runtime libs, fonts, espeak-ng + Piper voices.
FROM node:20-bookworm-slim

# Chrome Headless Shell runtime dependencies (Remotion's documented Linux set)
# + fonts, espeak-ng (fallback voice), Python/pip (Piper voice), build tools
# (native npm modules like better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 \
      libdbus-1-3 \
      libatk1.0-0 \
      libgbm-dev \
      libasound2 \
      libxrandr2 \
      libxkbcommon-dev \
      libxfixes3 \
      libxcomposite1 \
      libxdamage1 \
      libatk-bridge2.0-0 \
      libpango-1.0-0 \
      libcairo2 \
      libcups2 \
      fontconfig \
      fonts-dejavu-core \
      fonts-noto-color-emoji \
      espeak-ng \
      python3 \
      python3-pip \
      build-essential \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps first so this layer is cached across code changes.
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

# Pre-download Remotion's chrome-headless-shell at build time (network is
# available here) so the first render is fast. Best-effort: if it fails,
# remotion/render.js downloads it on first use.
RUN node -e "require('@remotion/renderer').ensureBrowser()" || true

# Piper (natural neural TTS) + English voices for the resume-video voiceover.
# Two voices so the narration matches the user's gender pick: lessac (female)
# and ryan (male). Best-effort, like the old nixpacks piper phase: if it fails
# the app still runs and narration.js falls back to gender-matched espeak-ng.
RUN pip install --break-system-packages --quiet piper-tts || pip install --quiet piper-tts || true
RUN python3 -m piper.download_voices en_US-lessac-medium --data-dir ./piper-voices || true
RUN python3 -m piper.download_voices en_US-ryan-high --data-dir ./piper-voices || true

EXPOSE 3000
CMD ["node", "server.js"]
