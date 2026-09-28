#!/usr/bin/env bash
# Rebuilds docs/demo/muni-demo.mp4 and docs/demo/muni-demo.gif from the reel rendered by
# web/e2e/demo-reel.mjs. Usage:
#
#   docs/demo/export.sh <capture dir>        # the DEMO_OUT the capture and the reel used
#
# The reel is <capture dir>/reel/NNNNN.jpg: 2560×1600 frames, 60 a second, already cut, timed and
# faded. This only encodes it twice: H.264 for the MP4, and a palette-optimised looping GIF.
# Needs ffmpeg (with libx264) and ffprobe.
set -euo pipefail

CAPTURE="${1:?usage: export.sh <capture dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_MP4="${OUT_MP4:-$HERE/muni-demo.mp4}"
OUT_GIF="${OUT_GIF:-$HERE/muni-demo.gif}"
FPS="${REEL_FPS:-60}"   # the reel (web/e2e/demo-reel.mjs renders 60 a second) and the MP4
GIF_FPS="${GIF_FPS:-15}"     # the least that still reads as smooth motion
GIF_WIDTH="${GIF_WIDTH:-620}" # the width the release page shows it at
# Each file has to stay under 10 MB: `scripts/release.mjs check` refuses a tag otherwise.
MAX_BYTES=$((10 * 1024 * 1024))
# Frames are full-range sRGB (JPEG); video is limited-range BT.709, tagged so players agree.
TAGS="-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709"

# The MP4: 1920×1200 at 60 frames a second, H.264 High, yuv420p, streamable, no audio.
ffmpeg -loglevel error -y -framerate $FPS -i "$CAPTURE/reel/%05d.jpg" \
  -vf "scale=1920:1200:flags=lanczos:out_range=tv:out_color_matrix=bt709,setsar=1,format=yuv420p" \
  -c:v libx264 -preset veryslow -crf 22 -pix_fmt yuv420p $TAGS -profile:v high -movflags +faststart -an "$OUT_MP4"

# The GIF: one palette for the whole film, gentle dithering, only what changes redrawn, loops forever.
ffmpeg -loglevel error -y -framerate $FPS -i "$CAPTURE/reel/%05d.jpg" -filter_complex \
  "fps=$GIF_FPS,scale=$GIF_WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 "$OUT_GIF"

for f in "$OUT_MP4" "$OUT_GIF"; do
  printf '%s  %s  %ss\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
  if [ "$(wc -c < "$f")" -gt $MAX_BYTES ]; then echo "  over 10 MB: a release would refuse it (docs/demo/README.md)" >&2; over=1; fi
done
exit "${over:-0}"
