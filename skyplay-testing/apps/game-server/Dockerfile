# ── Builder Stage: download cores, build Node.js app ──────────────
FROM mirror.gcr.io/library/node:22-bookworm-slim AS builder

WORKDIR /build

# Copy package files
COPY package.json package-lock.json* tsconfig.json ./
COPY src/ ./src/

# Install deps and build TypeScript
RUN npm ci && npm run build

# ── Runtime Stage ───────────────────────────────────────────────────
FROM mirror.gcr.io/library/debian:bookworm-slim

# Install runtime dependencies + RetroArch from Debian backports
# Acquire::Retries=5 handles intermittent network failures during download
RUN apt-get -o Acquire::Retries=5 update && \
    apt-get -o Acquire::Retries=5 install -y --no-install-recommends --fix-missing \
    # X11 virtual display
    xvfb \
    # FFmpeg for screen capture
    ffmpeg \
    # Input injection
    xdotool \
    # Node.js 22 (from NodeSource)
    curl \
    ca-certificates \
    gnupg \
    unzip \
    # D-Bus (needed by RetroArch to avoid SIGABRT on startup)
    dbus \
    dbus-x11 \
    # Runtime libs
    libsdl2-2.0-0 \
    libpulse0 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    libegl1 \
    libgles2 \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Install RetroArch from libretro nightly Debian repo
RUN curl -fsSL https://raw.githubusercontent.com/libretro/libretro-super/master/pkg/debian/add-repo.sh | bash - \
    && apt-get update && apt-get install -y retroarch \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download libretro cores
RUN mkdir -p /usr/lib/libretro && \
    for core_url in \
      "https://buildbot.libretro.com/nightly/linux/x86_64/latest/fbneo_libretro.so.zip" \
      "https://buildbot.libretro.com/nightly/linux/x86_64/latest/pcsx_rearmed_libretro.so.zip"; \
    do \
      core_name=$(basename "$core_url" .zip); \
      echo "Downloading $core_name..."; \
      curl -fsSL -o "/tmp/$core_name.zip" "$core_url" 2>/dev/null && \
      unzip -o "/tmp/$core_name.zip" -d /usr/lib/libretro/ 2>/dev/null && \
      echo "OK: $core_name" || \
      echo "WARNING: Failed to download $core_name"; \
    done && \
    rm -f /tmp/*.zip && \
    ls -la /usr/lib/libretro/

# Copy built Node.js app
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# ROMs mount point
RUN mkdir -p /roms

# Environment
ENV PORT=8080
ENV HOST=0.0.0.0
ENV RETROARCH_CORES_DIR=/usr/lib/libretro
ENV ROMS_DIR=/roms
ENV FRAME_ENCODE_QUALITY=5
ENV NODE_ENV=production

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

CMD ["node", "dist/index.js"]
