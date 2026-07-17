#!/bin/bash
# ── Entrypoint: persistent services for headless game sessions ──────
# Starts D-Bus, PulseAudio, and Xvfb ONCE for the container lifetime.
# Game sessions no longer manage these — they just wait for readiness.

set -e

XVFB_DISPLAY=${XVFB_DISPLAY:-:99}
XVFB_SCREEN=${XVFB_SCREEN:-1920x1440x24}
PULSE_LOGLEVEL=${PULSE_LOGLEVEL:-error}

echo "[entrypoint] Starting D-Bus..."
dbus-daemon --system --fork 2>/dev/null || echo "[entrypoint] D-Bus already running"

echo "[entrypoint] Starting PulseAudio (null sink)..."
pulseaudio --kill 2>/dev/null || true
sleep 1
pulseaudio --start --exit-idle-time=-1 --disallow-module-loading=0 --disallow-exit=1 --log-target=stderr --log-level="$PULSE_LOGLEVEL" 2>/dev/null
sleep 1
pactl load-module module-null-sink sink_name=game_sink sink_properties=device.description=GameAudio format=float32le rate=48000 channels=2 2>/dev/null || true
pactl set-default-sink game_sink 2>/dev/null || true
echo "[entrypoint] PulseAudio ready (sink: game_sink)"

echo "[entrypoint] Starting Xvfb $XVFB_DISPLAY ($XVFB_SCREEN)..."
# Kill any stale Xvfb and remove stale lock files — a killed Xvfb (e.g. on
# `docker-compose restart`, where /tmp persists) leaves /tmp/.X99-lock behind,
# which makes the new Xvfb abort with "Server is already active for display 99".
pkill Xvfb 2>/dev/null || true
sleep 1
DISPLAY_NUM="${XVFB_DISPLAY#:}"
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true
Xvfb "$XVFB_DISPLAY" -screen 0 "$XVFB_SCREEN" -nolisten tcp +extension GLX -noreset &
XVFB_PID=$!
echo "[entrypoint] Xvfb PID: $XVFB_PID"

# Wait for Xvfb to be ready (xdotool is our probe — xdpyinfo is not installed)
for i in $(seq 1 30); do
  if DISPLAY="$XVFB_DISPLAY" xdotool getdisplaygeometry >/dev/null 2>&1; then
    echo "[entrypoint] Xvfb $XVFB_DISPLAY ready (took ${i}s)"
    break
  fi
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Xvfb died during startup"
    exit 1
  fi
  sleep 1
done

# Verify
if ! DISPLAY="$XVFB_DISPLAY" xdotool getdisplaygeometry >/dev/null 2>&1; then
  echo "[entrypoint] ERROR: Xvfb failed to become ready after 30s"
  exit 1
fi

echo "[entrypoint] All services ready — launching game server"
exec node dist/index.js
