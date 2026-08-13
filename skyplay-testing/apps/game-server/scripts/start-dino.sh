#!/bin/sh
# Start RetroArch with dino.zip and NCI enabled
killall retroarch 2>/dev/null
sleep 1
DISPLAY=:99 \
SDL_VIDEODRIVER=x11 \
SDL_AUDIODRIVER=pulseaudio \
PULSE_SINK=game_sink \
nohup retroarch \
  -L /usr/lib/libretro/fbneo_libretro.so \
  /roms/dino.zip \
  -v \
  --appendconfig /tmp/ra-nci.cfg \
  > /tmp/ra-dino.log 2>&1 &
echo "RetroArch started PID=$!"
sleep 3
echo "Checking log:"
head -20 /tmp/ra-dino.log
