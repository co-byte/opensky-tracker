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
// White, so the color tint gives the exact color; the tip points up, the direction alignedAxis lines up with
const triangleImage =
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 32'><path d='M8 1L15 31H1z' fill='white'/></svg>";

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

	function markerScaleByDistance(entry) {
		const markerLengthMeters = (entry.model.drawLengthMeters * 2) / 3;
		const alwaysMarker = entry.model.file === null || modelFailures.has(entry);
		const firstShownDistance = alwaysMarker ? inspectRange(viewer, entry) : modelRangeMeters;
		const minimumSizeDistance = (markerLengthMeters * focalLengthPixels(viewer)) / minimumMarkerPixels;
		const firstShownScale = minimumSizeDistance / firstShownDistance;
		if (firstShownScale <= 1) {
			return undefined;
		}
		// Fitted against Cesium's curve: stays within 0.6 to 1.7 times 2/3 of the model (at least the minimum) and never grows while zooming out
		return new Cesium.NearFarScalar(firstShownDistance, firstShownScale, Math.max(0.6 * minimumSizeDistance, 1.5 * firstShownDistance), 1);
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
				marker.scaleByDistance = markerScaleByDistance(entry);
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
