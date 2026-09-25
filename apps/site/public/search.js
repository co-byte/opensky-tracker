import { formatNumber } from './common.js';

export function setupSearch({ aircraft, onFilter, onPick }) {
	const search = document.getElementById('search');
	const searchCount = document.getElementById('search-count');
	let query = '';
	let matches = aircraft;
	let matchIndex = -1;

	const matchesQuery = (entry) => [entry.callsign, entry.icao24, entry.category].some((text) => text?.toLowerCase().includes(query));

	search.disabled = false;
	search.addEventListener('input', () => {
		query = search.value.trim().toLowerCase();
		matches = query ? aircraft.filter(matchesQuery) : aircraft;
		matchIndex = -1;
		onFilter(new Set(matches));
		searchCount.textContent = query ? `${formatNumber(matches.length)} of ${formatNumber(aircraft.length)}` : '';
	});
	document.getElementById('search-form').addEventListener('submit', (event) => {
		event.preventDefault();
		if (!query || !matches.length) {
			return;
		}
		matchIndex = (matchIndex + 1) % matches.length;
		onPick(matches[matchIndex]);
	});
	search.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && search.value) {
			event.preventDefault();
			event.stopPropagation();
			search.value = '';
			search.dispatchEvent(new Event('input'));
		}
	});
}
