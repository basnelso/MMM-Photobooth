/* global Module */

/* Magic Mirror
 * Module: MMM-Photobooth
 *
 * By Brady Snelson
 */
Module.register('MMM-Photobooth',
{
	defaults:
	{
		driveDestination: '',
		videoRecodringLength: 10,
		useLights: true,
		linkText: '',
		deviceId: '',
    },

	start: function()
	{
		Log.info('Starting module: ' + this.name);
		this.cameraState = {};
		this.currentTemp = 'cool';
		this.lightTempIcons = {
			'cool': 'https://raw.githubusercontent.com/basnelso/MMM-Photobooth/master/images/cool.png',
			'medium': 'https://raw.githubusercontent.com/basnelso/MMM-Photobooth/master/images/medium.png',
			'warm': 'https://raw.githubusercontent.com/basnelso/MMM-Photobooth/master/images/warm.png',
		}
		this.cameraDeployed = false;
		this.pictureTimer = -1
		this.orientation = ''
		this.loadingPreview = false;
	},

	getStyles: function() {
		return ["MMM-Photobooth.css"]
	},

	// Add in buttons to control lights and pick the color tempurature
	// Add in uploading/uploaded message
	getDom: function() {
		if (this.loadingPreview) {
			const whiteBackground = document.createElement("div");
			whiteBackground.className = 'white-background'

			const loadingArrow = document.createElement("p");
			arrow.className = 'arrow-up';
			arrow.innerHTML = `&#x2191;`;

			const loadingText = document.createElement("p");
			loadingText.className = 'loadingText';
			loadingText.innerHTML = 'Look at the Camera';

			const textWrapper = document.createElement("div");
			textWrapper.className = 'text-wrapper';
			textWrapper.appendChild(loadingArrow);
			textWrapper.appendChild(loadingText);
			
			return whiteBackground;
		} else if (this.pictureTimer >= 0) {
			const isHorizontalPhoto = this.orientation == 'Horizontal'
			const whiteBackground = document.createElement("div");
			whiteBackground.className = 'black-background'

			const countdownLeft = document.createElement("p");
			const countdownRight = document.createElement("p")
			if (isHorizontalPhoto) {
				countdownLeft.className = "countdown-left-h";
				countdownRight.className = "countdown-right-h"
			} else {
				countdownLeft.className = "countdown-left-v";
				countdownRight.className = "countdown-right-v"
			}


			if (this.pictureTimer > 0) {
				countdownLeft.appendChild(document.createTextNode(this.pictureTimer))
				countdownRight.appendChild(document.createTextNode(this.pictureTimer))
			} else {
				countdownLeft.appendChild(document.createTextNode("X"))
				countdownRight.appendChild(document.createTextNode("X"))
			}

			const arrows = document.createElement("div");
			arrows.className = "arrows";

			const arrowl = document.createElement("p");
			const arrowc = document.createElement("p");
			const arrowr = document.createElement("p");
			arrowl.innerHTML = `&#x2197;`
			arrowc.innerHTML = `&#x2191;`
			arrowr.innerHTML = `&#x2196;`
			arrowl.className = "arrow";
			arrowc.className = "arrow-c";
			arrowr.className = "arrow";

			if (isHorizontalPhoto) {
				console.log("horizontal photo")
				arrowl.className = 'hidden-arrow';
				arrowr.className = 'hidden-arrow';
			} else {
				console.log('vertical photo')
				arrowc.className = 'hidden-arrow';
			}

			arrows.appendChild(arrowl);
			arrows.appendChild(arrowc);
			arrows.appendChild(arrowr);

			whiteBackground.appendChild(countdownLeft);
			whiteBackground.appendChild(countdownRight);
			whiteBackground.appendChild(arrows);

			return whiteBackground;
		}

		const wrapper = document.createElement("div");

		const capture_wrapper = document.createElement("span");
		const video_wrapper = document.createElement("span");
		const picture_wrapper = document.createElement("span");
		const lights_on_wrapper = document.createElement("div");
		const lights_off_wrapper = document.createElement("div");
		const lightTempWrapper = document.createElement("span");

		const verticalVideoButton = this.createCaptureButton('Video', 'Vertical');
		const horizontalVideoButton = this.createCaptureButton('Video', 'Horizontal');
		const verticalPicButton = this.createCaptureButton('Pic', 'Vertical');
		const horizontalPicButton = this.createCaptureButton('Pic', 'Horizontal');

		const lightOnButton = this.createLightControlButton('On');
		const lightOffButton = this.createLightControlButton('Off');

		const lightCoolButton = this.createLightTempButton('cool');
		const lightMediumButton = this.createLightTempButton('medium');
		const lightWarmButton = this.createLightTempButton('warm');

		lights_on_wrapper.appendChild(lightOnButton);
		lights_off_wrapper.appendChild(lightOffButton);

		lightTempWrapper.appendChild(lightCoolButton);
		lightTempWrapper.appendChild(lightMediumButton);
		lightTempWrapper.appendChild(lightWarmButton);

		video_wrapper.appendChild(verticalVideoButton);
		video_wrapper.appendChild(horizontalVideoButton);

		picture_wrapper.appendChild(verticalPicButton);
		picture_wrapper.appendChild(horizontalPicButton);

		var link_text = document.createElement("span");
		link_text.innerHTML = this.config.linkText;
		capture_wrapper.appendChild(link_text);

		capture_wrapper.appendChild(video_wrapper);
		capture_wrapper.appendChild(picture_wrapper);

		if (this.config.useLights) {
			capture_wrapper.appendChild(lightTempWrapper);
		}

		if (this.config.useLights) {
			wrapper.appendChild(lights_on_wrapper);
		}
		wrapper.appendChild(capture_wrapper);
		if (this.config.useLights) {
			wrapper.appendChild(lights_off_wrapper);
		}

		lightTempWrapper.className = 'light-temp-wrapper'
		lights_on_wrapper.className = 'lights-control-wrapper'
		lights_off_wrapper.className = 'lights-control-wrapper'
		capture_wrapper.className = 'capture-wrapper';
		video_wrapper.className = 'button_wrapper';
		picture_wrapper.className = 'button_wrapper';
		wrapper.className = 'master-wrapper';

		return wrapper;
	},

	createCaptureButton: function(type, orientation) {
		button = document.createElement("span");
		button.className = 'capture-button';
		var self = this;
		button.addEventListener('click', function () {
			self.orientation = orientation
			self.lightsOn();
			if (type == 'Video') {
				self.recordClip(orientation);
			} else if (type == 'Pic') {
				self.takePicture(orientation);
			}
		})

		button.innerHTML = `${orientation} ${type}`;
		return button;
	},

	createLightControlButton: function(mode) {
		button = document.createElement("span");
		button.className = 'capture-button light-button';
		var self = this;
		button.addEventListener('click', function () {
			if (mode == 'On' && !self.cameraDeployed) {
				self.lightsOn();
			} else if (mode == 'Off') {
				self.lightsOff();
			}
		})

		button.innerHTML = `Lights ${mode}`;
		return button;
	},

	createLightTempButton: function(temp) {
		button = document.createElement("span");
		
		if (this.currentTemp == temp) {
			button.className = 'light-temp-button temp-selected';
		} else {
			button.className = 'light-temp-button';
		}
		
		var self = this;
		button.addEventListener('click', function () {
			self.currentTemp = temp;
			self.updateDom();
			if (self.cameraDeployed) {
				console.log("camera is deployed so going to change the color temp to", temp)
				self.sendNotification('CHANGE_TEMP', temp)
			}
		})

		lightTempImage = document.createElement("img");
		lightTempImage.src = this.lightTempIcons[temp];
		lightTempImage.className = "light-temp-image";

		button.appendChild(lightTempImage)
		return button;
	},

	lightsOn: function() {
		if (!this.cameraDeployed) {
			this.cameraDeployed = true;
			this.sendNotification('LIGHTS_ON', this.currentTemp); // Send to hue module
		
			payload = {
				'command': 'useBooth',
				'bearer': this.config.bearer,
				'deviceId': this.config.deviceId
			}
			this.sendSocketNotification('MOVE_LIGHTS', payload); // Send to node helper
		}
	},

	lightsOff: function() {
		if (this.cameraDeployed) {
			this.cameraDeployed = false;
			console.log("switching lights back, the saved state is:", this.cameraState)
			this.sendNotification('REVERSE_LIGHTS_BACK', this.cameraState)

			payload = {
				'command': 'lightWall',
				'bearer': this.config.bearer,
				'deviceId': this.config.deviceId
			}
			this.sendSocketNotification('MOVE_LIGHTS', payload);
		} else {
			console.log('camera is deployed but going to try to switch color back still', this.cameraState)
			this.sendNotification('REVERSE_LIGHTS_BACK', this.cameraState)
		}
	},

	recordClip: function (orientation) {
		payload = {
			length: this.config.videoRecodringLength,
			orientation: orientation
		}
		this.sendSocketNotification('RECORD_CLIP', payload);
	},

	takePicture: function (orientation) {
		this.sendSocketNotification('TAKE_PICTURE', orientation);
		this.loadingPreview = true;
		this.updateDom();
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification == 'UPLOAD_CLIP') {
			this.pictureTimer = -1;
			this.updateDom();
			this.sendSocketNotification(notification, this.config.driveDestination);
		} else if (notification == 'REVERSE_LIGHTS_BACK') {
			this.lightsOff()
		} else if (notification == 'PREVIEW_WINDOW_OPENED') {
			this.loadingPreview = false;
			this.pictureTimer = 6;
			this.updatePictureTimer();
		}
    },

	notificationReceived: function(notification, payload, sender) {
		if (sender?.name == 'MMM-PhillipsHueController' && notification == 'SAVE_LIGHT_STATE') { // Recieve this from the
			console.log('Photobooth is saving the following camera state:', payload);
			this.cameraState = payload;
		}
	},

	updatePictureTimer: function() {
		this.pictureTimer -= 1;
		this.updateDom();

		self = this;

		if (this.pictureTimer > 0) {
			console.log("pic timer is greater than 0", this.pictureTimer)
			setTimeout(function () {
				self.updatePictureTimer();
			}, 1000);
		}
	}
});
