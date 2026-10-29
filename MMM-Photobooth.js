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
		defaultColorTemp: 300,
		minColorTemp: 153,
		maxColorTemp: 454,
		previewRestoreDelay: 2000,
		frozenPhotoDuration: 5000,
		photoPopDelay: 0,
		captureProcessingTimeout: 15000,
		photoCameraWarmup: 500,
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
		this.photoCaptured = false;
		this.frozenPhotoShowing = false;
		this.capturesProcessing = new Set();
		this.createShutterLayers();
	},

	// The glow and frozen photo live on the body rather than in getDom, so updateDom re-renders
	// during capture don't restart their animations or reload the image.
	createShutterLayers: function() {
		this.frozenPhoto = document.createElement("img");
		this.frozenPhoto.className = 'photobooth-frozen-photo';
		this.overlayHost = document.createElement("div");
		this.overlayHost.className = 'photobooth-overlay-host';
		document.body.appendChild(this.overlayHost);

		this.glow = document.createElement("div");
		this.glow.className = 'photobooth-glow';

		var self = this;
		this.frozenPhoto.addEventListener('click', function () { self.hideFrozenPhoto(); });

		document.body.appendChild(this.frozenPhoto);
		document.body.appendChild(this.glow);
	},

	// The preview only shows for a moment before the countdown starts, so fill the gap between it and the
	// camera with arrows angled up at the lens.
	createLookUpArrows: function() {
		const scale = window.devicePixelRatio || 1;
		const row = document.createElement("div");
		row.className = 'look-up-arrows';
		// Sized in screen pixels to the 1280x200 gap above the horizontal preview. This assumes the preview
		// window has no title bar (see the README); with one, the bottom of this row is hidden behind it.
		row.style.width = 1280 / scale + 'px';
		row.style.height = 200 / scale + 'px';
		row.style.fontSize = 170 / scale + 'px';

		const leftArrow = document.createElement("span");
		leftArrow.innerHTML = `&#x2197;`;
		const text = document.createElement("span");
		text.className = 'look-up-text';
		text.style.fontSize = 80 / scale + 'px';
		text.innerHTML = 'Look at camera';
		const rightArrow = document.createElement("span");
		rightArrow.innerHTML = `&#x2196;`;

		row.appendChild(leftArrow);
		if (this.recordingClip) row.appendChild(this.createRecordingDot(scale));
		row.appendChild(text);
		if (this.recordingClip) row.appendChild(this.createRecordingDot(scale));
		row.appendChild(rightArrow);
		return row;
	},

	// rpicam-vid's preview window sits empty for ~1.5 s while the camera gets ready; it draws over the page,
	// so fill the space around it with spinners in place of the countdown.
	buildCameraStartingDom: function() {
		const isHorizontal = this.orientation == 'Horizontal';
		const background = document.createElement("div");
		background.className = 'black-background';
		for (const side of ['left', 'right']) {
			const spinner = document.createElement("p");
			spinner.className = 'countdown-' + side + (isHorizontal ? '-h' : '-v');
			const icon = document.createElement("i");
			icon.className = 'fa-solid fa-circle-notch fa-spin camera-starting-spinner';
			spinner.appendChild(icon);
			background.appendChild(spinner);
		}
		if (isHorizontal) {
			const scale = window.devicePixelRatio || 1;
			const row = document.createElement("div");
			row.className = 'look-up-arrows';
			row.style.width = 1280 / scale + 'px';
			row.style.height = 200 / scale + 'px';
			const text = document.createElement("span");
			text.className = 'look-up-text';
			text.style.fontSize = 80 / scale + 'px';
			text.innerHTML = 'Starting camera&hellip;';
			row.appendChild(text);
			background.appendChild(row);
		}
		return background;
	},

	createRecordingDot: function(scale) {
		const dot = document.createElement("span");
		dot.className = 'recording-dot';
		dot.style.width = dot.style.height = 70 / scale + 'px';
		return dot;
	},

	// rpicam places its preview in screen pixels; the page is zoomed, so convert to CSS pixels.
	placeOverPreview: function(element, rect) {
		const scale = window.devicePixelRatio || 1;
		element.style.left = rect.left / scale + 'px';
		element.style.top = rect.top / scale + 'px';
		element.style.width = rect.width / scale + 'px';
		element.style.height = rect.height / scale + 'px';
	},

	// Restarting a CSS animation needs the class removed and a reflow before it is added back.
	restartAnimation: function(element, className) {
		element.classList.remove(className);
		void element.offsetWidth;
		element.classList.add(className);
	},

	photoWasCaptured: function(rect) {
		this.photoCaptured = true;
		// Clear the checkmarks as soon as the capture ends (updateDom is asynchronous), leaving black
		// until the frozen photo pops in.
		this.frozenPhotoShowing = true;
		this.overlayHost.replaceChildren(this.buildDom());
		this.placeOverPreview(this.glow, rect);
		this.restartAnimation(this.glow, 'burst');
	},

	showFrozenPhoto: function(photo) {
		var self = this;
		const image = this.frozenPhoto;
		this.frozenPhotoShowing = true;
		image.onload = function () {
			self.placeOverPreview(image, photo.rect);
			setTimeout(function () { self.restartAnimation(image, 'visible'); }, self.config.photoPopDelay);
			clearTimeout(self.frozenPhotoTimer);
			self.frozenPhotoTimer = setTimeout(function () { self.hideFrozenPhoto(); }, self.config.frozenPhotoDuration);
		};
		image.onerror = function () { self.hideFrozenPhoto(); };
		image.src = photo.url;
	},

	hideFrozenPhoto: function() {
		clearTimeout(this.frozenPhotoTimer);
		this.frozenPhoto.classList.remove('visible');
		this.frozenPhoto.onload = null;
		// Drop the decoded image so its memory is freed.
		this.frozenPhoto.removeAttribute('src');
		this.frozenPhotoShowing = false;
		// The checkmarks stay up with the frozen photo, so clear the countdown overlay with it.
		if (this.photoCaptured) {
			this.photoCaptured = false;
			this.pictureTimer = -1;
			this.updateDom();
		}
	},

	getStyles: function() {
		return ["MMM-Photobooth.css"]
	},

	// The full-screen countdown backgrounds are moved onto the body: inside the module's region they sat
	// under later regions such as MMM-OnSpotify, which z-index on the region didn't fix.
	getDom: function() {
		const dom = this.buildDom();
		const isFullScreen = dom.classList.contains('black-background');
		if (isFullScreen) {
			this.overlayHost.replaceChildren(dom);
			return document.createElement("div");
		}
		this.overlayHost.replaceChildren();
		return dom;
	},

	// Add in buttons to control lights and pick the color tempurature
	// Add in uploading/uploaded message
	buildDom: function() {
		// From the button press until the camera shows frames, the same spinners cover the wait.
		if (this.loadingPreview || this.cameraStarting) {
			return this.buildCameraStartingDom();
		} else if (this.frozenPhotoShowing) {
			// Just the dark backdrop behind the frozen photo; the checkmarks have done their job.
			const blackBackground = document.createElement("div");
			blackBackground.className = 'black-background';
			return blackBackground;
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


			// Horizontal clips put the recording dots in the row above the preview instead.
			if (this.recordingClip && !isHorizontalPhoto) {
				countdownLeft.classList.add('recording');
				countdownRight.classList.add('recording');
			}

			if (this.pictureTimer > 0) {
				countdownLeft.appendChild(document.createTextNode(this.pictureTimer))
				countdownRight.appendChild(document.createTextNode(this.pictureTimer))
			} else {
				countdownLeft.appendChild(document.createTextNode("\u2713"))
				countdownRight.appendChild(document.createTextNode("\u2713"))
				countdownLeft.classList.add('captured');
				countdownRight.classList.add('captured');
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
				arrowc.className = 'hidden-arrow';
				// The photo is being taken by the time the checkmarks show, so the arrows have done their job.
				if (this.pictureTimer > 0) {
					whiteBackground.appendChild(this.createLookUpArrows());
				}
			} else {
				console.log('vertical photo')
				arrowc.className = 'hidden-arrow';
			}

			arrows.appendChild(arrowl);
			arrows.appendChild(arrowc);
			arrows.appendChild(arrowr);

			whiteBackground.appendChild(countdownLeft);
			whiteBackground.appendChild(countdownRight);
			// Horizontal shots use the look-up row instead; the old arrows, hidden in black, sat on top of it
			// and cut through the recording dots.
			if (!isHorizontalPhoto) {
				whiteBackground.appendChild(arrows);
			}

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
		const processing = this.capturesProcessing.size > 0;
		button.className = processing ? 'booth-button booth-button-disabled' : 'booth-button';
		var self = this;
		button.addEventListener('click', function () {
			if (self.capturesProcessing.size > 0) return;
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
			captureId: this.nextCaptureId(),
			orientation: orientation
		}
		this.sendSocketNotification('RECORD_CLIP', payload);
		this.loadingPreview = true;
		this.updateDom();
	},

	// A clip is still encoding for a few seconds after it stops recording, so a new capture can start before
	// the previous one's UPLOAD_CLIP arrives. Numbering captures lets that late message leave the new one alone.
	nextCaptureId: function () {
		this.captureId = (this.captureId || 0) + 1;
		const captureId = this.captureId;
		this.capturesProcessing.add(captureId);
		var self = this;
		// Backstop in case the camera never starts, so capturedAt is never called.
		setTimeout(function () { self.captureFinished(captureId); }, 60000);
		return captureId;
	},

	// The buttons stay greyed out at most this long after the shot or clip ends, even if processing is still
	// running (a lost UPLOAD_CLIP would otherwise leave them greyed out).
	capturedAt: function () {
		const captureId = this.captureId;
		var self = this;
		setTimeout(function () { self.captureFinished(captureId); }, this.config.captureProcessingTimeout);
	},

	captureFinished: function (captureId) {
		if (!this.capturesProcessing.delete(captureId)) return;
		// Re-rendering mid-countdown would replay its animations; the buttons refresh when the overlay clears.
		const overlayShowing = this.loadingPreview || this.pictureTimer >= 0 || this.frozenPhotoShowing;
		if (!overlayShowing) this.updateDom();
	},

	takePicture: function (orientation) {
		this.sendSocketNotification('TAKE_PICTURE', { orientation: orientation, captureId: this.nextCaptureId() });
		this.loadingPreview = true;
		this.updateDom();
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification == 'UPLOAD_CLIP') {
			this.capturesProcessing.delete(payload?.captureId);
		}
		if (notification == 'UPLOAD_CLIP' && payload?.captureId !== this.captureId) {
			if (!(this.loadingPreview || this.pictureTimer >= 0 || this.frozenPhotoShowing)) this.updateDom();
			this.sendSocketNotification(notification, this.config.driveDestination);
		} else if (notification == 'UPLOAD_CLIP') {
			// The capture process has exited. Clear every overlay here as well: if the camera failed to start,
			// no preview notification arrives and the camera-starting spinners would otherwise stay up.
			this.loadingPreview = false;
			this.recordingClip = false;
			this.cameraStarting = false;
			// The black screen is waiting for a frozen photo; if none is coming, clear it now.
			if (this.frozenPhotoShowing && !this.frozenPhoto.getAttribute('src')) {
				this.hideFrozenPhoto();
			} else if (!this.frozenPhotoShowing) {
				this.photoCaptured = false;
				this.pictureTimer = -1;
				this.updateDom();
			}
			this.sendSocketNotification(notification, this.config.driveDestination);
		} else if (notification == 'PHOTO_CAPTURED') {
			this.capturedAt();
			this.photoWasCaptured(payload);
		} else if (notification == 'PHOTO_READY') {
			this.showFrozenPhoto(payload);
		} else if (notification == 'REVERSE_LIGHTS_BACK') {
			this.lightsOff()
		} else if (notification == 'PREVIEW_WINDOW_OPENED') {
			// The photo preview window is black for its first ~0.5 s and rpicam-jpeg logs nothing when frames
			// start, so show the camera-starting spinners for a fixed time. They take the first half of the "5",
			// which keeps every later number on its second and the checkmark just before the shot.
			var self = this;
			this.loadingPreview = false;
			this.cameraStarting = true;
			this.updateDom();
			setTimeout(function () {
				self.cameraStarting = false;
				self.pictureTimer = 5;
				self.updateDom();
				setTimeout(function () { self.updatePictureTimer(); }, 1000 - self.config.photoCameraWarmup);
			}, this.config.photoCameraWarmup);
		} else if (notification == 'VIDEO_CAMERA_STARTING') {
			this.loadingPreview = false;
			this.cameraStarting = true;
			this.updateDom();
		} else if (notification == 'RECORDING_STARTED') {
			this.loadingPreview = false;
			this.cameraStarting = false;
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
			this.capturedAt();
			setTimeout(function () {
				self.pictureTimer = -1;
				self.updateDom();
			}, 1000);
		}
	}
});
