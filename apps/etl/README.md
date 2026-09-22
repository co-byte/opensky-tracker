# opensky-pipeline

Tracks near-live aircraft over Belgium (Flanders & Brussels) using OpenSky Network data, built on Databricks.

## Pipeline

```mermaid
flowchart LR
    raw[("Raw OpenSky data")] --> clean["Clean & validate"] --> enrich["Enrich"]
    enrich --> aircraft[("Aircraft info")]
    enrich --> history[("Flight history")] --> latest[("Latest positions")]
```

## Tables

```mermaid
erDiagram
    "aircraft (silver)" {
        string icao24 PK
        int category
        string origin_country
    }

    "flight_state (silver)" {
        string icao24 PK, FK
        timestamp time_position PK
        double longitude
        double latitude
        double baro_altitude
        double velocity
        boolean baro_altitude_outlier
    }

    "latest_flight_state (gold)" {
        string icao24 PK, FK
        double longitude
        double latitude
        double baro_altitude
        double velocity
    }

    "aircraft (silver)" ||--o{ "flight_state (silver)" : "icao24"
    "flight_state (silver)" ||--|| "latest_flight_state (gold)" : "most recent state per icao24"
```

## Future work
- Include images of airframe by incorporating information from e.g. https://hexdb.io/ or https://airport-data.com
- Improve outlier detection, e.g. velocity bounds relative to aircraft type instead of one fixed range for everything, eventually informed by the actual airframe's known limits via additional lookups/enrichment.
- Creating a gold table to make it easy to see which areas see the most traffic.

## Related

The [Waypoint](https://github.com/co-byte/waypoint) project features a website that currently consumes latest_flight_state.
