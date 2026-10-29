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
		// Hue colour temperature in mireds: lower is cooler. 153-454 is the range Hue white-ambiance bulbs support.
		defaultColorTemp: 153,
		minColorTemp: 153,
		maxColorTemp: 454,
		previewRestoreDelay: 2000,
    },

	start: function()
	{
		Log.info('Starting module: ' + this.name);
		this.cameraState = {};
		this.currentTemp = this.config.defaultColorTemp;
		this.cameraDeployed = false;
		this.pictureTimer = -1
		this.orientation = ''
		this.loadingPreview = false;
		this.recordingClip = false;
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
			loadingArrow.className = 'arrow-up';
			loadingArrow.innerHTML = `&#x2191;`;

			const loadingText = document.createElement("p");
			loadingText.className = 'loadingText';
			loadingText.innerHTML = 'Look at the Camera';

			const textWrapper = document.createElement("div");
			textWrapper.className = 'text-wrapper';
			textWrapper.appendChild(loadingArrow);
			textWrapper.appendChild(loadingText);
			
			whiteBackground.appendChild(textWrapper);
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
		wrapper.className = 'booth-panel';

		if (this.config.linkText) {
			const linkText = document.createElement("div");
			linkText.className = 'booth-link-text';
			linkText.innerHTML = this.config.linkText;
			wrapper.appendChild(linkText);
		}

		// Photo and video sit either side of the lights toggle so the panel is symmetrical under the clock.
		const captureRow = document.createElement("div");
		captureRow.className = 'booth-row';
		captureRow.appendChild(this.createCaptureGroup('Pic', 'Photo'));
		if (this.config.useLights) {
			captureRow.appendChild(this.createGroup('Lights', [this.createLightToggleButton()]));
		}
		captureRow.appendChild(this.createCaptureGroup('Video', 'Video'));
		wrapper.appendChild(captureRow);

		const lightTempWrapper = document.createElement("div");
		lightTempWrapper.className = 'light-temp-wrapper';
		lightTempWrapper.appendChild(this.createLightTempSlider());
		wrapper.appendChild(lightTempWrapper);

		return wrapper;
	},

	createCaptureGroup: function(type, title) {
		return this.createGroup(title, [
			this.createCaptureButton(type, 'Vertical'),
			this.createCaptureButton(type, 'Horizontal'),
		]);
	},

	createGroup: function(title, buttonElements) {
		const group = document.createElement("div");
		group.className = 'booth-group';

		const heading = document.createElement("div");
		heading.className = 'booth-group-title';
		heading.innerHTML = title;
		group.appendChild(heading);

		const buttons = document.createElement("div");
		buttons.className = 'booth-group-buttons';
		buttonElements.forEach(button => buttons.appendChild(button));
		group.appendChild(buttons);
		return group;
	},

	createCaptureButton: function(type, orientation) {
		const button = document.createElement("div");
		button.className = 'booth-button';
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

		// A small outline in the shape of the frame makes the orientation readable at a glance.
		const frameShape = document.createElement("span");
		frameShape.className = 'booth-frame-shape booth-frame-' + orientation.toLowerCase();
		button.appendChild(frameShape);
		button.appendChild(document.createTextNode(orientation));
		return button;
	},

	createLightToggleButton: function() {
		const button = document.createElement("div");
		button.className = this.cameraDeployed ? 'booth-button booth-lights-button booth-lights-on' : 'booth-button booth-lights-button';
		const bulbIcon = document.createElement("i");
		bulbIcon.className = this.cameraDeployed ? 'fa-solid fa-lightbulb' : 'fa-regular fa-lightbulb';
		button.appendChild(bulbIcon);
		var self = this;
		button.addEventListener('click', function () {
			if (self.cameraDeployed) {
				self.lightsOff();
			} else {
				self.lightsOn();
			}
			self.updateDom();
		})
		return button;
	},

	createLightTempSlider: function() {
		const coolLabel = document.createElement("span");
		coolLabel.className = 'light-temp-label';
		coolLabel.innerHTML = 'Cool';

		const warmLabel = document.createElement("span");
		warmLabel.className = 'light-temp-label';
		warmLabel.innerHTML = 'Warm';

		const slider = document.createElement("input");
		slider.type = 'range';
		slider.className = 'light-temp-slider';
		slider.min = this.config.minColorTemp;
		slider.max = this.config.maxColorTemp;
		slider.value = this.currentTemp;

		var self = this;
		// Dragging fires many input events; the Hue bridge handles roughly 10 requests a second,
		// so send live updates at most every 250ms and always send the final value on release.
		var lastSent = 0;
		const setFromInput = function (isFinal) {
			self.currentTemp = Number(slider.value);
			const now = Date.now();
			if (isFinal || now - lastSent > 250) {
				lastSent = now;
				self.sendTempChange(isFinal);
			}
		};
		slider.addEventListener('input', function () { setFromInput(false); });
		slider.addEventListener('change', function () { setFromInput(true); });

		// On the mirror's touchscreen, Electron treats a touch drag as a scroll gesture, so the native
		// range input only responds to taps. Track the finger ourselves and move the slider to it.
		const setFromTouch = function (touch, isFinal) {
			const rect = slider.getBoundingClientRect();
			const fraction = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width));
			slider.value = Math.round(self.config.minColorTemp + fraction * (self.config.maxColorTemp - self.config.minColorTemp));
			setFromInput(isFinal);
		};
		slider.addEventListener('touchstart', function (event) {
			event.preventDefault();
			setFromTouch(event.touches[0], false);
		}, { passive: false });
		slider.addEventListener('touchmove', function (event) {
			event.preventDefault();
			setFromTouch(event.touches[0], false);
		}, { passive: false });
		slider.addEventListener('touchend', function (event) {
			event.preventDefault();
			setFromTouch(event.changedTouches[0], true);
		}, { passive: false });

		const sliderWrapper = document.createElement("div");
		sliderWrapper.className = 'light-temp-slider-wrapper';
		sliderWrapper.appendChild(coolLabel);
		sliderWrapper.appendChild(slider);
		sliderWrapper.appendChild(warmLabel);
		return sliderWrapper;
	},

	sendTempChange: function(isFinal) {
		if (this.cameraDeployed) {
			this.sendNotification('CHANGE_TEMP', this.currentTemp);
			return;
		}

		// With the booth packed away, touching the slider previews the colour on the camera lights
		// (without moving them) and puts the old colour back a couple of seconds after release.
		clearTimeout(this.previewTimer);
		this.sendNotification('PREVIEW_TEMP', this.currentTemp);
		if (isFinal) {
			var self = this;
			this.previewTimer = setTimeout(function () {
				self.sendNotification('END_PREVIEW');
			}, this.config.previewRestoreDelay);
		}
	},

	lightsOn: function() {
		clearTimeout(this.previewTimer);
		if (!this.cameraDeployed) {
			this.cameraDeployed = true;
			this.sendNotification('LIGHTS_ON', this.currentTemp); // Send to hue module
		
			const payload = {
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

			const payload = {
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
		const payload = {
			length: this.config.videoRecodringLength,
			orientation: orientation
		}
		this.sendSocketNotification('RECORD_CLIP', payload);
		this.loadingPreview = true;
		this.updateDom();
	},

	takePicture: function (orientation) {
		this.sendSocketNotification('TAKE_PICTURE', orientation);
		this.loadingPreview = true;
		this.updateDom();
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification == 'UPLOAD_CLIP') {
			// The capture process has exited. Clear every overlay here as well: if the camera failed to start,
			// no preview notification arrives and the white "Look at the Camera" screen would otherwise stay up.
			this.loadingPreview = false;
			this.recordingClip = false;
			this.pictureTimer = -1;
			this.updateDom();
			this.sendSocketNotification(notification, this.config.driveDestination);
		} else if (notification == 'REVERSE_LIGHTS_BACK') {
			this.lightsOff()
		} else if (notification == 'PREVIEW_WINDOW_OPENED') {
			this.loadingPreview = false;
			this.pictureTimer = 6;
			this.updatePictureTimer();
		} else if (notification == 'RECORDING_STARTED') {
			this.loadingPreview = false;
			this.pictureTimer = payload + 1; // updatePictureTimer decrements before the first render
			this.recordingClip = true;
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

		var self = this;

		if (this.pictureTimer > 0) {
			console.log("pic timer is greater than 0", this.pictureTimer)
			setTimeout(function () {
				self.updatePictureTimer();
			}, 1000);
		} else if (this.recordingClip) {
			// Unlike a photo, the clip has nothing left to capture once the countdown ends, so clear the overlay
			// instead of leaving it up until the upload starts.
			this.recordingClip = false;
			setTimeout(function () {
				self.pictureTimer = -1;
				self.updateDom();
			}, 1000);
		}
	}
});
