import { fetchAircraft } from './aircraft.js';
import { addBasemap } from './basemap.js';
import { setupControls } from './controls.js';
import { createDisplay } from './display.js';
import { createFlight } from './flight.js';
import { createSelection } from './selection.js';
import { setupSearch } from './search.js';
import { createViewer } from './viewer.js';

const viewer = createViewer();
addBasemap(viewer);
const flight = createFlight(viewer);
const selection = createSelection({ viewer, flight });
setupControls({ viewer, flight, selection });

const loading = document.getElementById('loading');
fetchAircraft().then(
	(aircraft) => {
		const display = createDisplay({ viewer, aircraft });
		display.ready.then(() => {
			loading.hidden = true;
		});
		setupSearch({
			aircraft,
			onFilter: (matched) => {
				display.show(matched);
				if (selection.current() && !matched.has(selection.current())) {
					selection.release();
				}
			},
			onPick: selection.select,
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
