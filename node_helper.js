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
		this.sendSocketNotification("STATUS_UPDATE", {
			status: "STATUS_UPLOADING"
		});

		const uploadUniqueFile = require('./upload.js');
		fs.readdir(VIDEO_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					console.log("Uploading " + file);
					uploadUniqueFile(file, VIDEO_PATH + file, destination, () => {
						self.sendSocketNotification("STATUS_UPDATE", {
							status: "STATUS_UPLOADED"
						});
					});
				});
			}
		});
		fs.readdir(IMAGE_PATH, function (err, files) {
			if (err) {
				console.error(err);
			} else {
				files.forEach(function (file) {
					console.log("Uploading " + file);
					uploadUniqueFile(file, IMAGE_PATH + file, destination, () => {
						self.sendSocketNotification("STATUS_UPDATE", {
							status: "STATUS_UPLOADED"
						});
					});
				});
			}
		});
	},

	recordClip: function (payload) {
		const filename = 'clip_' + moment().format('YYYY[_]MM[_]DD[_]h:mm:ss');
		const recordingWindow = spawn('bash', ['~/start_picam.sh', payload.length, filename, payload.orientation], { shell: true });
		var self = this;

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
				if (errorOutput.includes('Made X/EGL preview window')) {
					self.sendSocketNotification('RECORDING_STARTED', payload.length);
				}
			}
		});
		recordingWindow.on('exit', function (code) {
			if (code) {
				console.log('child process exited with code ' + code.toString());
			}
			// Upload once the script has finished: flipping and encoding the clip takes a variable few seconds,
			// so a fixed timer could fire before the file exists.
			self.sendSocketNotification('UPLOAD_CLIP');
		});

		setTimeout(function () {
			self.sendSocketNotification('REVERSE_LIGHTS_BACK')
		}, (1 + payload.length) * 1000);
	},

	takePicture: function (orientation) {
		console.log("in takepicture function in node helper")
		const filename = 'pic_' + moment().format('YYYY[_]MM[_]DD[_]h:mm:ss');
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

	moveLights: function (payload) {
		var myHeaders = new fetch.Headers();
		myHeaders.append("Authorization", `Bearer ${payload.bearer}`);
		myHeaders.append("Content-Type", "application/x-www-form-urlencoded");

		var urlencoded = new url.URLSearchParams();
		urlencoded.append("arg", payload.command);

		var requestOptions = {
			method: 'POST',
			headers: myHeaders,
			body: urlencoded,
			redirect: 'follow'
		};

		var endpoint = `https://api.particle.io/v1/devices/${payload.deviceId}/moveLights`;
		fetch(endpoint, requestOptions)
		.then(response => response.text())
		.then(result => console.log("Got result from particle",result))
		.catch(error => console.log('error from particle:', error));
	}
});
