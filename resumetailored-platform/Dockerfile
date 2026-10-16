# Next.js 14 production image for Railway.
# Root directory is set to resumetailored-platform, so the build context and
# this Dockerfile path are both relative to that folder.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install ALL dependencies (incl. dev) — the Next build needs tailwind/postcss/ts.
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* must be present at build time (they are inlined into the client
# bundle). Railway exposes service variables to the build as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# PDF export converts the server-rendered .docx with LibreOffice headless (never the browser's print
# dialog). Carlito is metric-compatible with Calibri so the PDF paginates like the Word file.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer fonts-crosextra-carlito fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
EXPOSE 3000
# `next start` binds 0.0.0.0 and honors the PORT env var Railway injects.
CMD ["npm", "run", "start"]
