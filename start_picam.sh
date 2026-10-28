#!/bin/bash
# Records a Photobooth clip: video from rpicam-vid (Camera Module 3), audio from the UM02 USB mic via arecord.
# Called by MMM-Photobooth/node_helper.js: start_picam.sh <seconds> <filename> <Horizontal|Vertical>
# The node helper uploads videos/clips/<filename>.mp4 ~10s after recording ends, so finish quickly.
recording_length=$1
filename=$2
orientation=$3

CLIPS_DIR=~/MagicMirror/modules/MMM-Photobooth/videos/clips
# Mic by name: the ALSA card number changes between boots (was card 2, now card 3).
AUDIO_DEVICE=hw:CARD=UM02,DEV=0
# The mic resets to max gain (+33dB) on boot, which buzzes and clips; 16/30 is +12dB.
amixer -q -c UM02 cset name="Mic Capture Volume" 16
# Extra seconds trimmed from the start of the audio, on top of the measured camera start-up delay.
# Positive if claps are heard late, negative if early.
AUDIO_TRIM_EXTRA=0.35  # measured with clap tests on 2026-10-28: same 0.35s lag at start and end of clip

if [[ "$orientation" == "Horizontal" ]]; then
	# Same preview rectangles as the photo command in node_helper.js, which sit centred on the mirror.
	size=(--width 1280 --height 720)
	preview=320,200,1280,720
else
	size=(--width 720 --height 1280)
	preview=650,0,600,1066
fi

# Work in RAM: writing the raw video and audio to the SD card stalled both recorders for 20+ seconds at a time.
work_dir=$(mktemp -d -p /dev/shm)
trap 'rm -rf "$work_dir"' EXIT

# Audio is recorded separately because rpicam-vid's built-in libav audio drifts (~1s late over a 10s clip).
arecord -q -D "$AUDIO_DEVICE" -f S16_LE -r 48000 -c 1 -d "$((recording_length + 3))" "$work_dir/audio.wav" &
arecord_pid=$!
audio_started=$(date +%s.%N)

# Full-field-of-view 2304x1296 sensor mode (the 1536x864 mode is a centre crop) with 4 buffers to keep camera memory (CMA) low;
# the default buffer count left almost no CMA free alongside MagicMirror.
# --vflip (not --rotation 180) matches the photo command: the camera is mounted upside down, and this also mirrors
# the preview so it behaves like looking in a mirror.
# stderr is passed through untouched because node_helper.js watches it for the preview-window line.
rpicam-vid -t "$((recording_length * 1000))" --mode 2304:1296:10:P --buffer-count 4 "${size[@]}" --framerate 30 \
	--vflip --autofocus-mode continuous -b 10000000 --profile high \
	-p "$preview" --info-text "" \
	--codec libav --libav-format mp4 -o "$work_dir/video.mp4" 2>&1 >/dev/null \
	| while IFS= read -r line; do
		# libav opens the output when encoding starts, so this marks the first video frame.
		[[ "$line" == "Output #0"* && ! -f "$work_dir/video_started" ]] && date +%s.%N > "$work_dir/video_started"
		echo "$line" >&2
	done

kill "$arecord_pid" 2>/dev/null
wait "$arecord_pid" 2>/dev/null

video_started=$(cat "$work_dir/video_started" 2>/dev/null || echo "$audio_started")
audio_trim=$(echo "t = $video_started - $audio_started + $AUDIO_TRIM_EXTRA; if (t < 0) t = 0; t" | bc)
audio_trim=$(printf "%.3f" "$audio_trim")  # ffmpeg rejects bc's leading-dot output like .72
echo "audio trimmed by ${audio_trim}s to line up with the first video frame" >&2

# The mic picks up 120Hz mains hum (plus harmonics) and sub-40Hz rumble; notch them out without touching voices.
HUM_FILTER="highpass=f=80:poles=2,bandreject=f=120:width_type=q:w=8,bandreject=f=240:width_type=q:w=8,bandreject=f=360:width_type=q:w=8"
# At +12dB mic gain clips come out around -39 LUFS (very quiet); normalise towards the ~-16 LUFS typical of phone video.
# Raising the mic gain instead brings back clipping on claps and the hum.
# The camera records mirrored (so the preview looks like a mirror); hflip turns the saved clip the right way round.
# Needs a re-encode, done on the hardware encoder (~4s for a 10s clip).
LOUDNESS_FILTER="loudnorm=I=-16:TP=-1.5:LRA=11"
ffmpeg -v error -y -i "$work_dir/video.mp4" -ss "$audio_trim" -i "$work_dir/audio.wav" -af "$HUM_FILTER,$LOUDNESS_FILTER" \
	-vf hflip -c:v h264_v4l2m2m -b:v 10M -map 0:v -map 1:a -ar 48000 -ac 1 -c:a aac -b:a 128k -shortest -movflags +faststart "$work_dir/out.mp4"

# Move only the finished file so the uploader never picks up a partial recording.
mkdir -p "$CLIPS_DIR"
mv "$work_dir/out.mp4" "$CLIPS_DIR/$filename.mp4"
