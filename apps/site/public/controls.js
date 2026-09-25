import { homeView } from './viewer.js';

export function setupControls({ viewer, flight, selection }) {
	const { scene, camera } = viewer;
	// The toolbar only holds the home button; it is moved out of the viewer so it sits in the panel
	document.getElementById('controls').append(viewer.homeButton.container);
	const compassNeedle = document.querySelector('#compass svg');
	// Like the home button, this flies instead of jumping; a locked camera keeps orbiting its aircraft
	document.getElementById('compass').addEventListener('click', () => {
		const selected = selection.current();
		if (!selected) {
			camera.flyTo({
				destination: camera.positionWC,
				orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
				duration: flight.flightDuration(camera.positionWC),
			});
			return;
		}
		flight.flyAround(selected, new Cesium.HeadingPitchRange(0, camera.pitch, Cesium.Cartesian3.magnitude(camera.position)));
	});
	scene.postRender.addEventListener(() => {
		compassNeedle.style.transform = `rotate(${-camera.heading}rad)`;
	});

	// The button's own destination is the default view rectangle, and flying needs the camera unlocked from any aircraft first
	viewer.homeButton.viewModel.command.beforeExecute.addEventListener((command) => {
		command.cancel = true;
		selection.release();
		camera.flyTo({ ...homeView, duration: flight.flightDuration(homeView.destination) });
	});
}
