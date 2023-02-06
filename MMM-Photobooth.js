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
	},

	getStyles: function() {
		return ["MMM-Photobooth.css"]
	},

	// Add in buttons to control lights and pick the color tempurature
	// Add in uploading/uploaded message
	getDom: function() {
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

		capture_wrapper.appendChild(video_wrapper);
		capture_wrapper.appendChild(picture_wrapper);



		var link_text = document.createElement("span");
		link_text.innerHTML = this.config.linkText;
		capture_wrapper.appendChild(link_text);

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
			self.lightsOn();
			if (type == 'video') {
				self.recordClip(orientation);
			} else if (type == 'pic') {
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
			self.lightsOn();
			if (mode == 'On') {
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

		button.addEventListener('click', function () {
			this.currentTemp = temp;
		})

		image = document.createElement("img");
		image.src = `/images/${temp}.png`
		button.appendChild(image)
		return button;
	},

	lightsOn: function() {
		this.sendNotification('LIGHTS_ON'); // Send to hue module
	
		payload = {
			'command': 'boothOn',
			'bearer': this.config.bearer,
			'deviceId': this.config.deviceId
		}
		this.sendSocketNotification('MOVE_LIGHTS', payload); // Send to node helper
	},

	lightsOff: function() {
		this.sendNotification('REVERSE_LIGHTS_BACK', this.cameraState)

		payload = {
			'command': 'lightWall',
			'bearer': this.config.bearer,
			'deviceId': this.config.deviceId
		}
		this.sendSocketNotification('MOVE_LIGHTS', payload);
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
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification == 'UPLOAD_CLIP') {
			this.sendSocketNotification(notification, this.config.driveDestination);
		} else if (notification == 'REVERSE_LIGHTS_BACK') {
			this.lightsOff()
		}
    },

	notificationReceived: function(notification, payload, sender) {
		if (sender = 'MMM-PhillipsHueController' && notification == 'SAVE_LIGHT_STATE') { // Recieve this from the
			this.cameraState = payload;
		}
	}
});
