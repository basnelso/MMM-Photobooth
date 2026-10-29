# MMM-1-Second-A-Day
This is a module for the [MagicMirror](https://github.com/MichMich/MagicMirror) platform.

Record daily 1-second-clips and automatically generate a 1-second-a-day video of your life.


## Configuration
[Sample MagicMirror repository w/ MMM-1-Second-A-Day set up](https://github.com/GaryLChew/SmartMirror)

The entry in config.js can look like the following. (NOTE: You only have to add the variables to config if want to change its standard value.)

```
{
	module: 'MMM-1-Second-A-Day',
	config:
	{
		driveDestination: 'YOUR_DRIVE_FOLDER'
	}
}
```

You must also integrate this module with your Google Drive in order to upload compilations online. See the "Google Drive Integration" section.

## Google Drive Integration
To properly set up uploading video compilations to Google Drive:
1. Follow this link: https://developers.google.com/drive/api/v3/quickstart/nodejs?
2. Ensure that you're logged into the desired google account in the top right of the web page.
3. In the dropdown under "Configure your OAuth client" select "Desktop app" and the press "Create".
4. Press "Download Client Configuration" and place file into the folder for this module.
5. Run command 'node upload.js' on command line, and follow steps.
6. Insert compilations into a specified folder. (Optional)
	1. On your browser open your Google Drive and go to the folder that you want to insert the compilations into.
	2. The link should be of the sort: https://drive.google.com/drive/u/0/folders/YOUR_DRIVE_FOLDER, paste YOUR_DRIVE_FOLDER into the module config.


## Capture screen
While a photo or clip is being taken the mirror goes black around the camera preview:

- "Starting camera…" spinners cover the second or so before the camera shows frames.
- A countdown on each side, with "Look at camera" and arrows above horizontal shots, and blinking red dots while a clip records.
- A checkmark and a glow burst when the photo is taken, then the photo itself pops in where the preview was and stays for
  `frozenPhotoDuration` (tap to dismiss).
- The capture buttons are greyed out until the previous capture has finished processing (at most
  `captureProcessingTimeout` after it).

| Option | Default | Description |
|---|---|---|
| `frozenPhotoDuration` | `5000` | How long (ms) the photo just taken stays on screen. |
| `photoCameraWarmup` | `500` | How long (ms) the spinners stay up after the photo preview window opens, while it is still black. |
| `captureProcessingTimeout` | `15000` | Longest time (ms) the capture buttons stay greyed out after a capture ends. |

The overlay is positioned for rpicam's preview rectangles (`-p` in `node_helper.js` and `start_picam.sh`) on a
1920x1080 screen. On Raspberry Pi OS with labwc, remove the preview window's title bar, which otherwise covers the
bottom of the "Look at camera" row, by adding this inside `<openbox_config>` in `~/.config/labwc/rc.xml`:

```xml
<windowRules><windowRule title="rpicam-app" serverDecoration="no"/></windowRules>
```

then run `labwc --reconfigure` (or log out and back in).

The screen-sized copy of each photo shown on the mirror is made with `djpeg`/`cjpeg` and the saved photo is un-mirrored
with `jpegtran`, all from `libjpeg-turbo-progs` (`sudo apt install libjpeg-turbo-progs`).

## Dependencies
## Open Source Licenses
The MIT License (MIT)

Copyright (c) 2017 Gary Chew and Kyle Stadelmann

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
