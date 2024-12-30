'use strict';
const NodeHelper = require('node_helper');
const fs = require('fs');
const moment = require('moment');
const { spawn } = require("child_process");
const PiCamera = require('pi-camera');
const fetch = require('node-fetch');
const url = require('url');
const { exec } = require('child_process');

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

		recordingWindow.stdout.on('data', function (data) {
			if (data) {
				console.log('stdout: ' + data.toString());
			}
		});
		recordingWindow.stderr.on('data', function (data) {
			if (data) {
				console.log('stderr: ' + data.toString());
			}
		});
		recordingWindow.on('exit', function (code) {
			if (code) {
				console.log('child process exited with code ' + code.toString());
			}
		});

		var self = this;
		setTimeout(function () {
			self.sendSocketNotification('UPLOAD_CLIP')
		}, (10 + payload.length) * 1000);
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
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 1920 --height 1080 -p 320,200,1280,720 --info-text "" --vflip`;
		} else if (orientation == 'Vertical') {
			command = `rpicam-jpeg --output ${IMAGE_PATH}/${filename}.jpg --timeout 5000 --width 1080 --height 1920 -p 650,0,600,1066 --info-text "" --vflip`;
		}

		console.log('about to take a picture')
		const process = exec(command);
		
		process.stderr.on('data', (data) => {
			const errorOutput = data.toString();
			console.log(`stderr: ${errorOutput}`); // Log output from stderr
		  
			// Check for the specific message from stderr
			if (errorOutput.includes('Still capture image received')) {
			  console.log('Capture complete (from stderr), performing further action...');
			  // Add your next steps here
			}
		  });
		
		process.on('close', (code) => {
		  console.log(`Child process exited with code ${code}`);
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
