# Waypoint

![Status: work in progress](https://img.shields.io/badge/status-work%20in%20progress-orange)
[![Last deploy](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fco-byte%2Fwaypoint%2Factions%2Fworkflows%2Fdeploy-flight-tracker-site.yaml%2Fruns%3Fstatus%3Dsuccess%26branch%3Dmain%26per_page%3D1&query=%24.workflow_runs%5B0%5D.updated_at&label=last%20deploy&cacheSeconds=300)](https://github.com/co-byte/waypoint/actions/workflows/deploy-flight-tracker-site.yaml)
[![License: MIT](https://img.shields.io/github/license/co-byte/waypoint)](LICENSE)


![Screenshot of the flight tracker map](https://placehold.co/1200x600?text=Screenshot+coming+soon)

A web map that shows live aircraft positions from [OpenSky Network](https://opensky-network.org/) data. 

## How it works

1. A Cloudflare Worker (`apps/site/`) fetches the latest flight data from Databricks.
2. The page uses [MapLibre](https://maplibre.org/) to display a map.
3. [deck.gl](https://deck.gl/) draws each aircraft on top of the map as a dot.

## Related projects

- [opensky-pipeline](https://github.com/co-byte/opensky-pipeline): the data pipeline that produces the flight data displayed by this site.

## Roadmap

### Site

Changes that can be made in this repository alone.

- [x] Show full runway shapes below zoom level 10
- [ ] Reduce aircraft position loading time using Cloudflare's caching features
- [ ] Move aircraft dots based on heading
- [ ] Enable selecting aircraft and viewing details

### Site and pipeline

Changes that also require work in [opensky-pipeline](https://github.com/co-byte/opensky-pipeline).

- [ ] Smoother animations using position prediction, which requires better data quality and a rework of the current read-optimized Databricks tables
- [ ] Add thumbnail and additional airframe information to aircraft detail view
- [ ] Store tracked aircraft counts, optionally by (broad) category, to feed live README badges
