const backgroundColor = '#181818';
const accentColor = '#c97c3d';

async function fetchJson(url, name) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${name} request failed: ${response.status}`);
	}
	return response.json();
}

const formatNumber = (number) => number.toLocaleString('en-US');
