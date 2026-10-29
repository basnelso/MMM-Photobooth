'use strict';
const NodeHelper = require('node_helper');
const fs = require('fs');
const moment = require('moment');
const { spawn } = require("child_process");
const PiCamera = require('pi-camera');
const fetch = require('node-fetch');
const url = require('url');
const { exec, execFile } = require('child_process');

const VIDEO_PATH = './modules/MMM-Photobooth/videos/clips/';
const IMAGE_PATH = './modules/MMM-Photobooth/pictures/clips/';
// Outside IMAGE_PATH so the screen-sized copy is never uploaded.
const FROZEN_PATH = './modules/MMM-Photobooth/pictures/frozen/';

module.exports = NodeHelper.create({
	start: function () {
		console.log("Starting node helper for: " + this.name);
		// The capture folders are untracked and empty after each upload; if one goes missing the camera
		// can't save and its preview hangs on screen, so make sure they exist.
		fs.mkdirSync(IMAGE_PATH, { recursive: true });
		fs.mkdirSync(VIDEO_PATH, { recursive: true });
		fs.mkdirSync(FROZEN_PATH, { recursive: true });
	},

	socketNotificationReceived: function (notification, payload) {
		console.log("received socket notification", notification);
		switch (notification) {
			case "MOVE_LIGHTS":
				this.moveLights(payload)
				break;
			case "RECORD_CLIP":
				this.recordClip(payload);
				break;
			case "TAKE_PICTURE":
				this.takePicture(payload);
				break;
			case "UPLOAD_CLIP":
				this.uploadClip(payload);
				break;
			case "":
				break;
		}
	},

	// Every UPLOAD_CLIP uploads everything in the folders, so back-to-back captures picked the same file up
	// twice; the first upload deleted it and the second crashed with ENOENT. Skip files already uploading.
	// Entries expire so a file whose upload failed is retried by a later capture.
	uploadRetryAfter: 2 * 60 * 1000,

	uploadClip: function (destination) {
		const uploadUniqueFile = require('./upload.js');
		const uploadsStarted = this.uploadsStarted = this.uploadsStarted || {};
		const now = Date.now();
		const startUpload = function (file, filePath) {
			if (uploadsStarted[file] && now - uploadsStarted[file] < this.uploadRetryAfter) {
				return;
			}
			uploadsStarted[file] = now;
			console.log("Uploading " + file);
			uploadUniqueFile(file, filePath, destination);
		}.bind(this);
		fs.readdir(VIDEO_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					startUpload(file, VIDEO_PATH + file);
				});
			}
		});
		fs.readdir(IMAGE_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					startUpload(file, IMAGE_PATH + file);
				});
			}
		});
	},

	recordClip: function (payload) {
		const filename = 'clip_' + moment().format('YYYY[_]MM[_]DD[_]HH:mm:ss');
		const recordingWindow = spawn('bash', ['~/start_picam.sh', payload.length, filename, payload.orientation], { shell: true });
		var self = this;
		var lightsTimer = null;
		var recordingStarted = false;

		recordingWindow.stdout.on('data', function (data) {
			if (data) {
				console.log('stdout: ' + data.toString());
			}
		});
		recordingWindow.stderr.on('data', function (data) {
			if (data) {
				const errorOutput = data.toString();
				console.log('stderr: ' + errorOutput);
				// rpicam-vid starts recording as soon as its preview window appears, so start the on-screen countdown then.
				// The preview window opens ~1.5 s before frames arrive (sensor mode switch and encoder set-up), and
				// libav opening the output marks the first recorded frame, so the countdown starts there.
				if (errorOutput.includes('Output #0') && !recordingStarted) {
					recordingStarted = true;
					self.sendSocketNotification('RECORDING_STARTED', payload.length);
				}
				if (errorOutput.includes('Made X/EGL preview window') && !lightsTimer) {
					self.sendSocketNotification('VIDEO_CAMERA_STARTING');
					// Time the lights from the preview window, not from launch: the camera takes over a second
					// to start, and timing from launch moved the lights during the last moments of the clip. Recording
					// itself begins ~1s after the preview appears, hence the extra 2s.
					lightsTimer = setTimeout(function () {
						self.sendSocketNotification('REVERSE_LIGHTS_BACK');
					}, (payload.length + 2) * 1000);
				}
			}
		});
		recordingWindow.on('exit', function (code) {
			if (code) {
				console.log('child process exited with code ' + code.toString());
			}
			// The camera never started, so the lights timer was never set; put the lights back now.
			if (!lightsTimer) {
				self.sendSocketNotification('REVERSE_LIGHTS_BACK');
			}
			// Upload once the script has finished: flipping and encoding the clip takes a variable few seconds,
			// so a fixed timer could fire before the file exists.
			self.sendSocketNotification('UPLOAD_CLIP', { captureId: payload.captureId });
		});
	},

	takePicture: function (payload) {
		const orientation = payload.orientation;
		const uploadPayload = { captureId: payload.captureId };
		console.log("in takepicture function in node helper")
		const filename = 'pic_' + moment().format('YYYY[_]MM[_]DD[_]HH:mm:ss');
		var self = this;
		var command = "";
		// Where rpicam draws its preview, so the page can freeze the shot in the same place.
		const previewRect = orientation == 'Vertical'
			? { left: 650, top: 0, width: 600, height: 1066 }
			: { left: 320, top: 200, width: 1280, height: 720 };
		// The room behind the booth is dark and fills most of the frame, so average metering overexposed the
		// lit subject. Meter on the centre of the frame, where the subject stands, instead.
		const imageTuning = `--metering spot`;
		if (orientation == 'Horizontal') {
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 4608 --height 2592 -p 320,200,1280,720 --info-text "" --vflip --immediate ${imageTuning}`;
		} else if (orientation == 'Vertical') {
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 1456 --height 2592 -p 650,0,600,1066 --info-text "" --vflip --immediate ${imageTuning}`;
		}

		console.log('about to take a picture')
		const process = exec(command);
		
		process.stderr.on('data', (data) => {
			const errorOutput = data.toString();
			console.log(`stderr: ${errorOutput}`); // Log output from stderr
		  
			// Check for the specific message from stderr
			if (errorOutput.includes('Made X/EGL preview window')) {
			  console.log('Sending preview window open notification');
			  self.sendSocketNotification('PREVIEW_WINDOW_OPENED');
			}
		  });
		
		process.on('close', (code) => {
		  console.log(`Child process exited with code ${code}`);
		  if (code !== 0) {
		    self.sendSocketNotification('REVERSE_LIGHTS_BACK');
		    self.sendSocketNotification('UPLOAD_CLIP', uploadPayload);
		    return;
		  }
		  // Signalled on exit rather than on rpicam's "Still capture image received": redrawing the page while
		  // rpicam was still saving the JPEG stalled it for over 4 s with the preview frozen on screen.
		  self.sendSocketNotification('PHOTO_CAPTURED', previewRect);
		  self.sendSocketNotification('REVERSE_LIGHTS_BACK');
		  const imageFile = `${IMAGE_PATH}/${filename}.jpg`;
		  self.showFrozenPhoto(imageFile, previewRect, function () {
		    self.unmirrorPhoto(imageFile, uploadPayload);
		  });
		});
	},

	// Decoding the full 12 MP photo froze the page for ~5 s, so show a copy at 3/8 scale (about screen size).
	// djpeg scales during decoding, which takes ~0.1 s. It is made from the still-mirrored capture, so it
	// already matches the preview.
	showFrozenPhoto: function (imageFile, previewRect, done) {
		var self = this;
		fs.readdirSync(FROZEN_PATH).forEach(function (file) {
			fs.rmSync(FROZEN_PATH + file, { force: true });
		});
		const frozenName = `frozen_${Date.now()}.jpg`;
		exec(`djpeg -scale 3/8 "${imageFile}" | cjpeg -quality 85 > "${FROZEN_PATH}${frozenName}"`, (error) => {
			if (error) {
				console.log('Could not make the frozen photo:', error.message);
			} else {
				self.sendSocketNotification('PHOTO_READY', {
					url: `/modules/MMM-Photobooth/pictures/frozen/${frozenName}`,
					rect: previewRect
				});
			}
			done();
		});
	},

	unmirrorPhoto: function (imageFile, uploadPayload) {
		var self = this;
		// --vflip mirrors the capture so the preview behaves like a mirror; flip the saved photo back the right way round.
		const unmirroredFile = imageFile.replace(/\.jpg$/, '.unmirrored.jpg');
		// jpegtran flips the JPEG losslessly; re-encoding would compress the photo a second time.
		// -perfect fails rather than trimming edge pixels (both sensor widths are multiples of 16, so it never should).
		execFile('jpegtran', ['-flip', 'horizontal', '-perfect', '-copy', 'all', '-outfile', unmirroredFile, imageFile], (error) => {
			if (error) {
				console.log('Could not un-mirror photo, uploading it as captured:', error.message);
			} else {
				fs.renameSync(unmirroredFile, imageFile);
			}
			self.sendSocketNotification('UPLOAD_CLIP', uploadPayload);
		});
	},

	// Particle can take several seconds to answer and does not keep calls in order: during quick successive
	// photos a late "useBooth" ran after the following "lightWall" and left the lights out. So only one call is in
	// flight at a time, and while it runs only the newest request is kept, since the final position is all that matters.
	lightsMoveRetries: 4,
	lightsMoveRetryDelay: 1000,

	moveLights: function (payload, attempt = 0) {
		if (this.lightsMoveInFlight && attempt === 0) {
			this.pendingLightsMove = payload;
			return;
		}
		this.lightsMoveInFlight = true;

		var myHeaders = new fetch.Headers();
		myHeaders.append("Authorization", `Bearer ${payload.bearer}`);
		myHeaders.append("Content-Type", "application/x-www-form-urlencoded");

		var urlencoded = new url.URLSearchParams();
		urlencoded.append("arg", payload.command);

		var requestOptions = {
			method: 'POST',
			headers: myHeaders,
			body: urlencoded,
			redirect: 'follow',
			// A hung request would block every later move, so give up after 20s.
			timeout: 20000
		};

		var self = this;
		var endpoint = `https://api.particle.io/v1/devices/${payload.deviceId}/moveLights`;
		fetch(endpoint, requestOptions)
		.then(response => response.text())
		.then(result => {
			console.log("Got result from particle for " + payload.command, result);
			// The Photon drops off the Particle cloud every few minutes; the cloud rejects the call straight
			// away when it does, so try again shortly unless a newer move has already replaced this one.
			const unreachable = result.includes("unreachable");
			if (unreachable && attempt < self.lightsMoveRetries && !self.pendingLightsMove) {
				console.log(`Photon unreachable, retrying ${payload.command} (${attempt + 1}/${self.lightsMoveRetries})`);
				setTimeout(() => self.moveLights(payload, attempt + 1), self.lightsMoveRetryDelay);
				return true;
			}
		})
		.catch(error => console.log('error from particle:', error))
		.then(retrying => {
			if (retrying) {
				return;
			}
			self.lightsMoveInFlight = false;
			const nextMove = self.pendingLightsMove;
			self.pendingLightsMove = null;
			if (nextMove) {
				self.moveLights(nextMove);
			}
		});
	}
});
