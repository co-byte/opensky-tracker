const viewer = new Cesium.Viewer('viewer', {
	// The default base layer and terrain need a Cesium ion token; the base layer is added below
	baseLayer: false,
	animation: false,
	baseLayerPicker: false,
	fullscreenButton: false,
	geocoder: false,
	infoBox: false,
	navigationHelpButton: false,
	sceneModePicker: false,
	selectionIndicator: false,
	timeline: false,
	// Cesium otherwise ignores the display's pixel ratio, so the globe renders at half resolution on high-DPI screens
	useBrowserRecommendedResolution: false,
});
const { scene, camera } = viewer;
// The models are CC BY 3.0, which requires crediting the authors
viewer.creditDisplay.addStaticCredit(
	new Cesium.Credit(
		'Aircraft models: Poly by Google, Silly Fear, Yogoshimo 2.0, Miha Lunar, jeremy, Vojtěch Balák, Eik Røgeberg via Poly Pizza, <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank">CC BY 3.0</a>, modified (<a href="/models/CREDITS.md" target="_blank">details</a>)',
	),
);
viewer.creditDisplay.addStaticCredit(
	new Cesium.Credit('Flight data: <a href="https://opensky-network.org/" target="_blank">OpenSky Network</a>'),
);
viewer.creditDisplay.addStaticCredit(
	new Cesium.Credit('Globe: <a href="https://cesium.com/platform/cesiumjs/" target="_blank">CesiumJS</a>'),
);
// The link leads to the full list of elevation datasets the tiles require crediting
viewer.creditDisplay.addStaticCredit(
	new Cesium.Credit(
		'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen, AWS Terrain Tiles</a>',
	),
);
Promise.all([import('https://cdn.jsdelivr.net/npm/maplibre-gl@6.10.0/dist/maplibre-gl.mjs'), loadBasemapStyle()]).then(
	([maplibregl, style]) => {
		viewer.imageryLayers.addImageryProvider(new MapLibreImageryProvider(maplibregl, style, 3, () => scene.requestRender()));
	},
);
// The default of 2 picks coarser imagery levels, which then show up magnified and blurry
scene.globe.maximumScreenSpaceError = 1;
scene.globe.baseColor = Cesium.Color.fromCssColorString(backgroundColor);
// Performance: the scene is static most of the time, so frames are only drawn when the camera moves or a tile loads; changes made from code need scene.requestRender()
scene.requestRenderMode = true;
scene.globe.showGroundAtmosphere = false;
scene.skyAtmosphere.show = false;
scene.skyBox.show = false;
scene.sun.show = false;
scene.moon.show = false;
scene.backgroundColor = Cesium.Color.fromCssColorString(backgroundColor);

// Right-drag zooms by default; here it tilts and rotates like the map's right-drag did
Object.assign(scene.screenSpaceCameraController, {
	zoomEventTypes: [
		Cesium.CameraEventType.WHEEL,
		Cesium.CameraEventType.PINCH,
		// Touchpad pinch reaches the page as a wheel event with Ctrl held
		{ eventType: Cesium.CameraEventType.WHEEL, modifier: Cesium.KeyboardEventModifier.CTRL },
	],
	tiltEventTypes: [
		Cesium.CameraEventType.RIGHT_DRAG,
		Cesium.CameraEventType.MIDDLE_DRAG,
		Cesium.CameraEventType.PINCH,
		{ eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
	],
});

// Testing showed touchpads require higher sensitivity than mouse scrolls
viewer.canvas.addEventListener('wheel', (event) => {
	const mouseWheel = !event.ctrlKey && (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) >= 100);
	scene.screenSpaceCameraController.zoomFactor = mouseWheel ? 5 : 12.5;
});

// Straight down with north up, high enough that the whole globe fits with room around it on a landscape screen
const homeView = { destination: Cesium.Cartesian3.fromDegrees(18.1, 37.5, 25_000_000) };
camera.setView(homeView);

// Beyond this distance a model is only a few pixels, so markers take over
const modelRangeMeters = 500_000;
// Evaluated by Cesium every frame, so an aircraft is never drawn as both, however stale the loading below is
const modelDisplayRange = new Cesium.DistanceDisplayCondition(0, modelRangeMeters);
const markerDisplayRange = new Cesium.DistanceDisplayCondition(modelRangeMeters, Number.MAX_VALUE);
// Models start loading a little before they become visible, so they are ready when the camera arrives
const modelLoadRangeMeters = modelRangeMeters * 1.1;
const models = new Map();
const modelFailures = new Set();
const markerOf = new Map();

const minimumMarkerPixels = 5;
// Leaves room around the aircraft for its marker and details
const inspectLengthPixels = 150;

function focalLengthPixels() {
	return viewer.canvas.clientHeight / (2 * Math.tan(camera.frustum.fovy / 2));
}

function inspectRange(aircraft) {
	return (aircraft.model.drawLengthMeters * focalLengthPixels()) / inspectLengthPixels;
}

function markerScaleByDistance(aircraft) {
	const markerLengthMeters = (aircraft.model.drawLengthMeters * 2) / 3;
	const alwaysMarker = aircraft.model.file === null || modelFailures.has(aircraft);
	const firstShownDistance = alwaysMarker ? inspectRange(aircraft) : modelRangeMeters;
	const minimumSizeDistance = (markerLengthMeters * focalLengthPixels()) / minimumMarkerPixels;
	const firstShownScale = minimumSizeDistance / firstShownDistance;
	if (firstShownScale <= 1) {
		return undefined;
	}
	// Fitted against Cesium's curve: stays within 0.6 to 1.7 times 2/3 of the model (at least the minimum) and never grows while zooming out
	return new Cesium.NearFarScalar(firstShownDistance, firstShownScale, Math.max(0.6 * minimumSizeDistance, 1.5 * firstShownDistance), 1);
}
// Shared, so an aircraft does not change color when it switches between a marker and a model
const aircraftColor = Cesium.Color.fromCssColorString('#8a8a86');

function modelMatrix(aircraft) {
	// The models' nose points along -Z, which Cesium turns into -X, so the nose is opposite the frame's forward axis:
	// the heading is measured clockwise from east instead of north, and a climb needs a negative pitch
	const orientation = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(aircraft.heading) + Cesium.Math.PI_OVER_TWO, -aircraft.pitch, 0);
	return Cesium.Transforms.headingPitchRollToFixedFrame(aircraft.position, orientation);
}

let searchQuery = '';

function matchesSearch(aircraft) {
	return !searchQuery || [aircraft.callsign, aircraft.icao24, aircraft.category].some((text) => text?.toLowerCase().includes(searchQuery));
}

function showModel(aircraft) {
	const { file, drawLengthMeters } = aircraft.model;
	const model = Cesium.Model.fromGltfAsync({
		id: aircraft,
		url: `/models/${file}.glb`,
		modelMatrix: modelMatrix(aircraft),
		scale: drawLengthMeters,
		distanceDisplayCondition: modelDisplayRange,
		minimumPixelSize: 2,
		color: aircraftColor,
		// The default mode multiplies the tint with each model's own tones, so only their lightest parts would get the exact color
		colorBlendMode: Cesium.ColorBlendMode.REPLACE,
		// Thin surfaces such as wings are single-sided and vanish from above otherwise
		backFaceCulling: false,
	}).then(
		(loaded) => {
			loaded.show = matchesSearch(aircraft);
			scene.primitives.add(loaded);
			scene.requestRender();
			return loaded;
		},
		(error) => {
			console.error(`Model ${file}.glb failed to load for aircraft ${aircraft.icao24}`, error);
			modelFailures.add(aircraft);
			const marker = markerOf.get(aircraft);
			marker.distanceDisplayCondition = undefined;
			marker.scaleByDistance = markerScaleByDistance(aircraft);
			scene.requestRender();
			return null;
		},
	);
	models.set(aircraft, model);
}

function hideModel(aircraft) {
	models.get(aircraft).then((model) => {
		if (model) {
			scene.primitives.remove(model);
		}
	});
	models.delete(aircraft);
}

let selected = null;

// Points straight down from the selected aircraft, showing what it is flying over
const groundLine = scene.primitives.add(new Cesium.PolylineCollection()).add({
	show: false,
	width: 2,
	material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(accentColor) }),
});

const selectionBox = document.getElementById('selection-box');
const details = document.getElementById('details');
const groups = document.getElementById('groups');
const summary = document.getElementById('summary');
// Keeps the box visible when the aircraft is only a marker
const minimumBoxPixels = 24;
const boxPaddingPixels = 6;
const detailsGapPixels = 12;
const header = document.getElementById('header');

function showDetails(aircraft) {
	const value = (number, scale = 1) => (number == null ? null : formatNumber(Math.round(number * scale)));
	const rate = aircraft.verticalRate == null ? null : Math.round(aircraft.verticalRate);
	const arrow = rate > 0 ? '▲ ' : rate < 0 ? '▼ ' : '';
	// The aircraft itself first, then what it is doing right now
	const identity = document.createElement('div');
	const callsign = document.createElement('h2');
	callsign.textContent = aircraft.callsign ?? '-';
	const registration = document.createElement('p');
	registration.textContent = `${aircraft.icao24} · ${aircraft.category}`;
	identity.append(callsign, registration);
	const state = document.createElement('dl');
	for (const [label, text, unit] of [
		['Altitude', value(aircraft.altitude), 'm'],
		['Speed', value(aircraft.speed, 3.6), 'km/h'],
		['Heading', value(aircraft.heading), '°'],
		['Vertical rate', rate == null ? null : arrow + Math.abs(rate), 'm/s'],
	]) {
		const term = document.createElement('dt');
		term.textContent = label;
		const description = document.createElement('dd');
		description.textContent = text ?? '-';
		if (text != null) {
			description.dataset.unit = unit;
		}
		const cell = document.createElement('div');
		cell.append(term, description);
		state.append(cell);
	}
	groups.replaceChildren(identity, state);
	summary.hidden = true;
	summary.replaceChildren();
	// Shown once it arrives, unless the aircraft was deselected meanwhile or has no summary
	fetchJson(`/api/aircraft-summary?icao24=${encodeURIComponent(aircraft.icao24)}`, 'Aircraft summary')
		.then(({ summary }) => summary)
		.catch((error) => {
			console.error(error);
			return 'Summary unavailable';
		})
		.then((text) => {
			if (text && selected === aircraft) {
				summary.innerHTML =
					'<svg viewBox="0 0 24 24" role="img" aria-label="Generated by AI"><title>Generated by AI</title><path d="M10 2l2.5 7.5L20 12l-7.5 2.5L10 22l-2.5-7.5L0 12l7.5-2.5zM19 1l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg>';
				summary.append(text);
				summary.hidden = false;
				scene.requestRender();
			}
		});
}

// A square around the aircraft's position, which is the center of its model; Cesium's bounding sphere of a model is off-center and too small
function projectBox(aircraft) {
	const radius = aircraft.model.drawLengthMeters / 2;
	const edgePosition = Cesium.Cartesian3.add(
		aircraft.position,
		Cesium.Cartesian3.multiplyByScalar(camera.rightWC, radius, new Cesium.Cartesian3()),
		new Cesium.Cartesian3(),
	);
	const center = Cesium.SceneTransforms.worldToWindowCoordinates(scene, aircraft.position);
	const edge = Cesium.SceneTransforms.worldToWindowCoordinates(scene, edgePosition);
	// Undefined when the point is behind the camera, where no box can be drawn
	if (!center || !edge) {
		return null;
	}
	const side = Math.max(2 * Math.hypot(edge.x - center.x, edge.y - center.y) + 2 * boxPaddingPixels, minimumBoxPixels);
	return { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side };
}

// The toolbar only holds the home button; it is moved out of the viewer so it sits in the panel
document.getElementById('controls').append(viewer.homeButton.container);
const compassNeedle = document.querySelector('#compass svg');
// Like the home button, this flies instead of jumping; a locked camera keeps orbiting its aircraft
document.getElementById('compass').addEventListener('click', () => {
	if (!selected) {
		camera.flyTo({
			destination: camera.positionWC,
			orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
			duration: flightDuration(camera.positionWC),
		});
		return;
	}
	flyAround(selected, new Cesium.HeadingPitchRange(0, camera.pitch, Cesium.Cartesian3.magnitude(camera.position)));
});

scene.postRender.addEventListener(() => {
	compassNeedle.style.transform = `rotate(${-camera.heading}rad)`;
	const box = selected && projectBox(selected);
	selectionBox.hidden = details.hidden = !box;
	if (!box) {
		return;
	}
	selectionBox.style.transform = `translate(${box.x}px, ${box.y}px)`;
	selectionBox.style.width = `${box.width}px`;
	selectionBox.style.height = `${box.height}px`;
	// Beside the box, on whichever side has room
	const { offsetWidth, offsetHeight } = details;
	const fitsRight = box.x + box.width + detailsGapPixels + offsetWidth <= innerWidth - detailsGapPixels;
	const x = fitsRight ? box.x + box.width + detailsGapPixels : box.x - detailsGapPixels - offsetWidth;
	const y = Math.min(Math.max(box.y, header.offsetHeight), innerHeight - detailsGapPixels - offsetHeight);
	details.style.transform = `translate(${x}px, ${y}px)`;
});

// Cesium's collision detection does not reliably keep a camera locked to an aircraft above the map, so orbiting a low aircraft could end up below the ground
const minimumCameraHeightMeters = 5;
scene.postUpdate.addEventListener(() => {
	// A free camera is kept above the ground by Cesium; only a locked one needs this
	if (Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY) || camera.positionCartographic.height >= minimumCameraHeightMeters) {
		return;
	}
	const target = Cesium.Matrix4.getTranslation(camera.transform, new Cesium.Cartesian3());
	const range = Cesium.Cartesian3.magnitude(camera.position);
	const targetHeight = Cesium.Cartographic.fromCartesian(target).height;
	// Adjusting the pitch instead of the position keeps the distance to the aircraft, and an aircraft high above the ground can still be viewed from below
	const pitch = -Math.asin(Math.min((minimumCameraHeightMeters - targetHeight) / range, 1));
	camera.lookAt(target, new Cesium.HeadingPitchRange(camera.heading, pitch, range));
	scene.requestRender();
});

// Also unlocks the camera, so dragging pans again instead of orbiting the aircraft
function releaseAircraft() {
	selected = null;
	groundLine.show = false;
	scene.requestRender();
	// A fly-to still in progress would otherwise lock the camera to the aircraft when it lands
	camera.cancelFlight();
	camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

// Cesium's own default duration (2 to 3 seconds, growing with the distance) made 50% shorter
function flightDuration(destination) {
	return 0.5 * Math.min(Math.ceil(Cesium.Cartesian3.distance(camera.positionWC, destination) / 1_000_000) + 2, 3);
}

function flyAround(aircraft, offset) {
	camera.flyToBoundingSphere(new Cesium.BoundingSphere(aircraft.position), {
		offset,
		// The camera ends up a range away from the aircraft, which is small next to the distance flown
		duration: flightDuration(aircraft.position),
		// Locking the camera to the aircraft makes dragging orbit around it
		complete: () => camera.lookAt(aircraft.position, offset),
	});
}

function centerOnAircraft(aircraft) {
	const { drawLengthMeters } = aircraft.model;
	const range = inspectRange(aircraft);
	// A camera locked to another aircraft would fly relative to that frame
	releaseAircraft();
	selected = aircraft;
	// Starting below the center keeps the line from cutting through the model's underside; the drop never goes below the ground
	const drop = Math.min(drawLengthMeters * 0.05, Math.max(aircraft.altitude, 0));
	const { longitude, latitude } = aircraft;
	groundLine.positions = Cesium.Cartesian3.fromDegreesArrayHeights([longitude, latitude, aircraft.altitude - drop, longitude, latitude, 0]);
	groundLine.show = true;
	showDetails(aircraft);
	// Keeping the current heading and pitch approaches the aircraft along the line of sight instead of snapping to a top view
	flyAround(aircraft, new Cesium.HeadingPitchRange(camera.heading, camera.pitch, range));
}

// The button's own destination is the default view rectangle, and flying needs the camera unlocked from any aircraft first
viewer.homeButton.viewModel.command.beforeExecute.addEventListener((command) => {
	command.cancel = true;
	releaseAircraft();
	camera.flyTo({ ...homeView, duration: flightDuration(homeView.destination) });
});

const loading = document.getElementById('loading');
fetchAircraft().then(
	(aircraft) => {
		const markers = scene.primitives.add(new Cesium.BillboardCollection());
		const modeled = aircraft.filter((entry) => entry.model.file !== null);
		// White, so the color tint below gives the exact color; the tip points up, the direction alignedAxis lines up with
		const triangleImage =
			"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 32'><path d='M8 1L15 31H1z' fill='white'/></svg>";
		// Aircraft without a model are always markers, at any distance
		aircraft.forEach((entry) => {
			const heading = Cesium.Math.toRadians(entry.heading);
			// A direction in world space, so the marker keeps pointing along the true heading and climb however the camera turns
			const direction = Cesium.Matrix4.multiplyByPointAsVector(
				Cesium.Transforms.eastNorthUpToFixedFrame(entry.position),
				new Cesium.Cartesian3(Math.sin(heading) * Math.cos(entry.pitch), Math.cos(heading) * Math.cos(entry.pitch), Math.sin(entry.pitch)),
				new Cesium.Cartesian3(),
			);
			const marker = markers.add({
				id: entry,
				position: entry.position,
				image: triangleImage,
				// The triangle spans 30 of the image's 32 units
				height: (minimumMarkerPixels * 32) / 30,
				width: (minimumMarkerPixels * 32) / 30 / 2.2,
				alignedAxis: direction,
				scaleByDistance: markerScaleByDistance(entry),
				distanceDisplayCondition: entry.model.file === null ? undefined : markerDisplayRange,
				color: aircraftColor,
			});
			markerOf.set(entry, marker);
		});
		// Nothing requests a frame when the image finishes loading, so the markers would stay invisible until the camera moves
		const removeReadyCheck = scene.preUpdate.addEventListener(() => {
			if (!markers.length || markers.get(0).ready) {
				removeReadyCheck();
				loading.hidden = true;
				scene.requestRender();
			}
		});
		scene.requestRender();

		const updateModels = () => {
			for (const entry of modeled) {
				if (modelFailures.has(entry)) {
					continue;
				}
				const near = Cesium.Cartesian3.distance(camera.positionWC, entry.position) < modelLoadRangeMeters;
				if (near && !models.has(entry)) {
					showModel(entry);
				} else if (!near && models.has(entry)) {
					hideModel(entry);
				}
			}
		};
		camera.percentageChanged = 0.1;
		camera.changed.addEventListener(updateModels);
		camera.moveEnd.addEventListener(updateModels);
		updateModels();

		new Cesium.ScreenSpaceEventHandler(viewer.canvas).setInputAction(({ position }) => {
			// Only aircraft carry an id
			const picked = scene.pick(position)?.id;
			if (picked) {
				centerOnAircraft(picked);
			} else if (selected) {
				releaseAircraft();
			}
		}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && selected) {
				releaseAircraft();
			}
		});

		const search = document.getElementById('search');
		const searchCount = document.getElementById('search-count');
		let matches = aircraft;
		let matchIndex = -1;
		search.disabled = false;
		search.addEventListener('input', () => {
			searchQuery = search.value.trim().toLowerCase();
			matches = aircraft.filter(matchesSearch);
			matchIndex = -1;
			const matched = new Set(matches);
			for (const entry of aircraft) {
				markerOf.get(entry).show = matched.has(entry);
				models.get(entry)?.then((model) => {
					if (model) {
						model.show = matched.has(entry);
					}
				});
			}
			if (selected && !matchesSearch(selected)) {
				releaseAircraft();
			}
			searchCount.textContent = searchQuery ? `${formatNumber(matches.length)} of ${formatNumber(aircraft.length)}` : '';
			scene.requestRender();
		});
		document.getElementById('search-form').addEventListener('submit', (event) => {
			event.preventDefault();
			if (searchQuery && matches.length) {
				matchIndex = (matchIndex + 1) % matches.length;
				centerOnAircraft(matches[matchIndex]);
			}
		});
		search.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && search.value) {
				event.preventDefault();
				event.stopPropagation();
				search.value = '';
				search.dispatchEvent(new Event('input'));
			}
		});
	},
	(error) => {
		// Only the fetch is handled here: a failure while setting up the scene must not claim the data is unavailable
		// A spinner that never ends would claim the aircraft are still on their way
		loading.hidden = true;
		document.getElementById('feed-error').hidden = false;
		throw error;
	},
);
