# Decisions

## 3D models or 2D icons first

- **Dilemma:** start with 2D icons or go straight to 3D models.
- **Context:** 3D is the end goal, and each step should be kept rather than replaced.
- **Options:**
  - 2D icons: simpler to render, but the icon assets and atlas are discarded later.
  - 3D models: nothing is discarded, but models must be created, one layer per type is needed, and performance is a risk.
- **Conclusion:** 3D models from the start.

## Runways below zoom level 10

- **Dilemma:** how to show runways where the map tiles have no runway data.
- **Context:** the tiles carry runway data from zoom 10 upward only.
- **Options:**
  - Airport icon from the tiles: no extra data, but patchy and not a runway shape.
  - Local GeoJSON from OpenStreetMap: same data source as the tiles and small, but a data file lives in the repository.
  - Vector tiles hosted separately: scales best, but needs extra tooling.
- **Conclusion:** local GeoJSON with runways of 1500 m or longer.

## Map engine: MapLibre or Cesium

- **Dilemma:** keep patching MapLibre with deck.gl for camera work around aircraft, or try a globe engine built for 3D scenes.
- **Context:** MapLibre's globe camera ignores the center elevation and deck.gl's globe view misplaces it, so each camera fix needed a workaround. Aircraft positions are now worldwide.
- **Options:**
  - Keep MapLibre and deck.gl: the map style and terrain stay, but the camera needs several workarounds.
  - Drop the globe and use the flat map: consistent camera, but the world view is distorted.
  - Switch to Cesium: one camera model for globe, altitude and orbiting, but the basemap, terrain and controls are rewritten.
- **Conclusion:** try Cesium in the branch `feat/cesium-globe` for globe, models and click-to-orbit before deciding.
