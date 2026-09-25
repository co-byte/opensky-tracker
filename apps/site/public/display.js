const minimumMarkerPixels = 5;
// Leaves room around the aircraft for its marker and details
const inspectLengthPixels = 150;
// Beyond this distance a model is only a few pixels, so markers take over
const modelRangeMeters = 500_000;
// Evaluated by Cesium every frame, so an aircraft is never drawn as both, however stale the loading below is
const modelDisplayRange = new Cesium.DistanceDisplayCondition(0, modelRangeMeters);
const markerDisplayRange = new Cesium.DistanceDisplayCondition(modelRangeMeters, Number.MAX_VALUE);
// Models start loading a little before they become visible, so they are ready when the camera arrives
const modelLoadRangeMeters = modelRangeMeters * 1.1;
// Shared, so an aircraft does not change color when it switches between a marker and a model
const aircraftColor = Cesium.Color.fromCssColorString('#8a8a86');
// The chevron spans 30 of the image's 38 units of height, the rest is a transparent margin that keeps its edges clear of the image's border
const chevronWidthUnits = 32;
const chevronHeightUnits = 38;
const chevronPixelsPerUnit = minimumMarkerPixels / 30;
// White, so the color tint gives the exact color; the tip points up, the direction alignedAxis lines up with
// Drawn on a canvas and passed as a PNG URL so all markers share one texture; high resolution, because zooming in scales a marker up tenfold
function createChevronImage() {
	const texelsPerUnit = 4;
	const canvas = document.createElement('canvas');
	canvas.width = chevronWidthUnits * texelsPerUnit;
	canvas.height = chevronHeightUnits * texelsPerUnit;
	const context = canvas.getContext('2d');
	context.scale(texelsPerUnit, texelsPerUnit);
	context.fillStyle = 'white';
	context.beginPath();
	context.moveTo(16, 4);
	context.lineTo(28, 34);
	context.lineTo(16, 26);
	context.lineTo(4, 34);
	context.fill();
	return canvas.toDataURL();
}
const chevronImage = createChevronImage();

function focalLengthPixels(viewer) {
	return viewer.canvas.clientHeight / (2 * Math.tan(viewer.camera.frustum.fovy / 2));
}

export function inspectRange(viewer, aircraft) {
	return (aircraft.model.drawLengthMeters * focalLengthPixels(viewer)) / inspectLengthPixels;
}

function modelMatrix(aircraft) {
	// The models' nose points along -Z, which Cesium turns into -X, so the nose is opposite the frame's forward axis:
	// the heading is measured clockwise from east instead of north, and a climb needs a negative pitch
	const orientation = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(aircraft.heading) + Cesium.Math.PI_OVER_TWO, -aircraft.pitch, 0);
	return Cesium.Transforms.headingPitchRollToFixedFrame(aircraft.position, orientation);
}

export function createDisplay({ viewer, aircraft }) {
	const { scene, camera } = viewer;
	const markers = scene.primitives.add(new Cesium.BillboardCollection());
	const models = new Map();
	const modelFailures = new Set();
	const markerOf = new Map();
	// Null shows every aircraft
	let visible = null;

	const isVisible = (entry) => !visible || visible.has(entry);

	// Cesium keeps a billboard the same size on screen at any distance and only interpolates its scale between two distances,
	// so the scale is set every frame to what perspective gives, like the models: a marker is 2/3 of its model, never below the minimum
	function updateMarkerScales() {
		const focalLength = focalLengthPixels(viewer);
		for (const entry of aircraft) {
			const distance = Cesium.Cartesian3.distance(camera.positionWC, entry.position);
			const markerLengthPixels = ((entry.model.drawLengthMeters * 2) / 3) * (focalLength / distance);
			markerOf.get(entry).scale = Math.max(1, markerLengthPixels / minimumMarkerPixels);
		}
	}

	function showModel(entry) {
		const { file, drawLengthMeters } = entry.model;
		const model = Cesium.Model.fromGltfAsync({
			id: entry,
			url: `/models/${file}.glb`,
			modelMatrix: modelMatrix(entry),
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
				loaded.show = isVisible(entry);
				scene.primitives.add(loaded);
				scene.requestRender();
				return loaded;
			},
			(error) => {
				console.error(`Model ${file}.glb failed to load for aircraft ${entry.icao24}`, error);
				modelFailures.add(entry);
				const marker = markerOf.get(entry);
				marker.distanceDisplayCondition = undefined;
				scene.requestRender();
				return null;
			},
		);
		models.set(entry, model);
	}

	function hideModel(entry) {
		models.get(entry).then((model) => {
			if (model) {
				scene.primitives.remove(model);
			}
		});
		models.delete(entry);
	}

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
			image: chevronImage,
			height: chevronHeightUnits * chevronPixelsPerUnit,
			width: chevronWidthUnits * chevronPixelsPerUnit,
			alignedAxis: direction,
			distanceDisplayCondition: entry.model.file === null ? undefined : markerDisplayRange,
			color: aircraftColor,
		});
		markerOf.set(entry, marker);
	});

	scene.preRender.addEventListener(updateMarkerScales);

	// Nothing requests a frame when the image finishes loading, so the markers would stay invisible until the camera moves
	const ready = new Promise((resolve) => {
		const removeReadyCheck = scene.preUpdate.addEventListener(() => {
			if (!markers.length || markers.get(0).ready) {
				removeReadyCheck();
				scene.requestRender();
				resolve();
			}
		});
	});
	scene.requestRender();

	const modeled = aircraft.filter((entry) => entry.model.file !== null);
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

	function show(matched) {
		visible = matched;
		for (const entry of aircraft) {
			markerOf.get(entry).show = isVisible(entry);
			models.get(entry)?.then((model) => {
				if (model) {
					model.show = isVisible(entry);
				}
			});
		}
		scene.requestRender();
	}

	return { ready, show };
}
