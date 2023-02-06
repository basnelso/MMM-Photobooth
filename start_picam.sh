#! /bin/sh
recording_length=$1
filename=$2
orientation=$3

echo $orientation

cd ~/picam
if [[ "$orientation" == "Horizontal" ]]; then
	echo first
	~/picam/picam --alsadev hw:2,0 --rotation 180 --samplerate 44100 --preview --previewrect 640,360,1280,720 &
else
	echo second
	~/picam/picam --alsadev hw:2,0 --samplerate 44100 --rotation 180 --preview --previewrect 987,240,585,960 -h 1280 -w 720 &
fi
	
pid=$!

sleep 3

echo -e "filename=$filename.ts" > ~/picam/hooks/start_record

sleep $recording_length

touch ~/picam/hooks/stop_record

sleep 3

kill $pid

cd ~/picam/rec/archive
ffmpeg -i $filename.ts -c:v copy -c:a copy -bsf:a aac_adtstoasc $filename.mp4

sleep 3

mv $filename.mp4 ~/MagicMirror/modules/MMM-1-Second-A-Day/videos/clips
rm $filename.ts
cd ..
rm $filename.ts