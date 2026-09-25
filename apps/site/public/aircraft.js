async function fetchAircraft() {
	const data = await fetchJson('/api/latest-flight-state', 'Latest flight state');
	const columns = (data.manifest?.schema?.columns ?? []).map(({ name }) => name);
	// Number(null) is 0, which would turn a missing velocity into a vertical climb
	const optionalNumber = (value) => (value == null ? null : Number(value));
	return (data.result?.data_array ?? [])
		.map((values) => Object.fromEntries(values.map((value, index) => [columns[index], value])))
		.filter((row) => row.longitude != null && row.latitude != null && row.geo_altitude != null)
		.map((row) => {
			const [longitude, latitude, altitude] = [row.longitude, row.latitude, row.geo_altitude].map(Number);
			const rate = optionalNumber(row.vertical_rate);
			const speed = optionalNumber(row.velocity);
			return {
				longitude,
				latitude,
				altitude,
				position: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
				model: findAircraftModel(row.category),
				category: row.category,
				heading: optionalNumber(row.true_track) ?? 0,
				speed,
				verticalRate: rate,
				icao24: row.icao24,
				callsign: row.callsign?.trim() || null,
				pitch: rate == null || speed == null ? 0 : Math.atan2(rate, speed),
			};
		});
}

// Categories are the labels the gold table delivers, not OpenSky's numeric codes
const aircraftModels = [
	{
		// Too little is known about these to pick a shape, so they stay markers
		file: null,
		categories: [
			'No information',
			'No ADS-B emitter category information',
			'Parachutist / skydiver',
			'Reserved',
			'Space / trans-atmospheric vehicle',
			'Surface vehicle - emergency vehicle',
			'Surface vehicle - service vehicle',
			'Point obstacle',
			'Cluster obstacle',
			'Line obstacle',
		],
		drawLengthMeters: 720,
	},
	{ file: 'light', categories: ['Light'], drawLengthMeters: 2100 },
	{ file: 'small', categories: ['Small'], drawLengthMeters: 3300 },
	{ file: 'airliner', categories: ['Large', 'High vortex large'], drawLengthMeters: 4500 },
	{ file: 'heavy', categories: ['Heavy'], drawLengthMeters: 6000 },
	{ file: 'fighter', categories: ['High performance'], drawLengthMeters: 3000 },
	{ file: 'helicopter', categories: ['Rotorcraft'], drawLengthMeters: 2700 },
	{ file: 'glider', categories: ['Glider / sailplane'], drawLengthMeters: 2700 },
	{ file: 'airship', categories: ['Lighter-than-air'], drawLengthMeters: 5400 },
	{ file: 'hang-glider', categories: ['Ultralight / hang-glider / paraglider'], drawLengthMeters: 2400 },
	{ file: 'drone', categories: ['Unmanned aerial vehicle'], drawLengthMeters: 500 },
];

function findAircraftModel(category) {
	const model = aircraftModels.find(({ categories }) => categories.includes(category ?? 'No information'));
	if (!model) {
		throw new Error(`Unknown aircraft category: ${category}`);
	}
	return model;
}
