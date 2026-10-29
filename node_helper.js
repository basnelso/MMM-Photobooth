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

module.exports = NodeHelper.create({
	start: function () {
		console.log("Starting node helper for: " + this.name);
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

	uploadClip: function (destination) {
		const uploadUniqueFile = require('./upload.js');
		fs.readdir(VIDEO_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					console.log("Uploading " + file);
					uploadUniqueFile(file, VIDEO_PATH + file, destination);
				});
			}
		});
		fs.readdir(IMAGE_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					console.log("Uploading " + file);
					uploadUniqueFile(file, IMAGE_PATH + file, destination);
				});
			}
		});
	},

	recordClip: function (payload) {
		const filename = 'clip_' + moment().format('YYYY[_]MM[_]DD[_]HH:mm:ss');
		const recordingWindow = spawn('bash', ['~/start_picam.sh', payload.length, filename, payload.orientation], { shell: true });
		var self = this;
		var lightsTimer = null;

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
				if (errorOutput.includes('Made X/EGL preview window') && !lightsTimer) {
					self.sendSocketNotification('RECORDING_STARTED', payload.length);
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
			self.sendSocketNotification('UPLOAD_CLIP');
		});
	},

	takePicture: function (orientation) {
		console.log("in takepicture function in node helper")
		const filename = 'pic_' + moment().format('YYYY[_]MM[_]DD[_]HH:mm:ss');
		var self = this;
		var command = "";
		if (orientation == 'Horizontal') {
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 1920 --height 1080 -p 320,200,1280,720 --info-text "" --vflip --immediate`;
		} else if (orientation == 'Vertical') {
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 1080 --height 1920 -p 650,0,600,1066 --info-text "" --vflip --immediate`;
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
		  self.sendSocketNotification('REVERSE_LIGHTS_BACK');
		  // --vflip mirrors the capture so the preview behaves like a mirror; flip the saved photo back the right way round.
		  const imageFile = `${IMAGE_PATH}/${filename}.jpg`;
		  const unmirroredFile = `${IMAGE_PATH}/${filename}.unmirrored.jpg`;
		  execFile('ffmpeg', ['-v', 'error', '-y', '-i', imageFile, '-vf', 'hflip', '-q:v', '1', unmirroredFile], (error) => {
		    if (error) {
		      console.log('Could not un-mirror photo, uploading it as captured:', error.message);
		    } else {
		      fs.renameSync(unmirroredFile, imageFile);
		    }
		    self.sendSocketNotification('UPLOAD_CLIP');
		  });
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
