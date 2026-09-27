#!/usr/bin/env bash
# Rebuilds docs/demo/muni-demo.mp4 and docs/demo/muni-demo.gif from frames captured by
# web/e2e/demo.mjs. Usage:
#
#   docs/demo/export.sh <capture dir>        # the DEMO_OUT the capture used
#
# Each segment (<capture dir>/frames/NN-name/list.ffconcat: frames with their real durations) is
# resampled to a constant 30 fps at 1280×800, the segments are joined with short crossfades, and
# the result is encoded twice: H.264 for the MP4, and a palette-optimised looping GIF.
# Needs ffmpeg (with libx264) and ffprobe.
set -euo pipefail

CAPTURE="${1:?usage: export.sh <capture dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_MP4="${OUT_MP4:-$HERE/muni-demo.mp4}"
OUT_GIF="${OUT_GIF:-$HERE/muni-demo.gif}"
FPS=30          # the MP4
GIF_FPS=15      # the GIF
GIF_WIDTH=960
FADE=0.4        # crossfade between segments, seconds
WORK="$CAPTURE/export"
# Frames are full-range sRGB (JPEG); video is limited-range BT.709, tagged so players agree.
TAGS="-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709"
rm -rf "$WORK" && mkdir -p "$WORK"

# 1 · each segment to a constant-rate clip
segments=()
for dir in "$CAPTURE"/frames/*/; do
  name="$(basename "$dir")"
  length=$(awk '$1 == "duration" { s += $2 } END { printf "%.4f", s }' "$dir/list.ffconcat")
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$dir/list.ffconcat" -t "$length" \
    -vf "fps=$FPS,scale=1280:800:flags=lanczos:out_range=tv:out_color_matrix=bt709,setsar=1,format=yuv420p" \
    -c:v libx264 -preset medium -crf 8 $TAGS -an "$WORK/$name.mp4"
  segments+=("$WORK/$name.mp4")
done
echo "segments: ${#segments[@]}"

# 2 · join them with crossfades (each fade starts FADE before the previous clip ends)
inputs=()
filter=""
offset=0
prev="0:v"
for i in "${!segments[@]}"; do
  inputs+=(-i "${segments[$i]}")
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${segments[$i]}")
  printf '  %-28s %6.2f s\n' "$(basename "${segments[$i]}" .mp4)" "$d"
  if [ "$i" -gt 0 ]; then
    filter+="[$prev][$i:v]xfade=transition=fade:duration=$FADE:offset=$offset[v$i];"
    prev="v$i"
  fi
  offset=$(awk -v o="$offset" -v d="$d" -v f="$FADE" 'BEGIN { printf "%.4f", o + d - f }')
done
filter="${filter%;}"
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "$filter" -map "[$prev]" \
  -c:v libx264 -preset medium -crf 8 -pix_fmt yuv420p $TAGS -r $FPS -an "$WORK/master.mp4"

# 3 · the MP4: H.264, yuv420p, streamable, no audio
ffmpeg -loglevel error -y -i "$WORK/master.mp4" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p $TAGS \
  -profile:v high -movflags +faststart -an "$OUT_MP4"

# 4 · the GIF: one palette for the whole film, gentle dithering, loops forever
ffmpeg -loglevel error -y -i "$WORK/master.mp4" -filter_complex \
  "fps=$GIF_FPS,scale=$GIF_WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 "$OUT_GIF"

for f in "$OUT_MP4" "$OUT_GIF"; do
  printf '%s  %s  %ss\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
done
