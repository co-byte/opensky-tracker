export const backgroundColor = '#181818';
export const accentColor = '#c97c3d';

export async function fetchJson(url, name) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${name} request failed: ${response.status}`);
	}
	return response.json();
}

export const formatNumber = (number) => number.toLocaleString('en-US');
