from pyspark import pipelines as dp

OPENSKY_ENRICHED_TABLE = spark.conf.get("opensky_enriched_table")
AIRCRAFT_TABLE = spark.conf.get("aircraft_table")
AIRCRAFT_CHANGES_VIEW = spark.conf.get("aircraft_changes_view")

FAIL_EXPECTATIONS = {}
DROP_EXPECTATIONS = {}
WARN_EXPECTATIONS = {}


@dp.temporary_view(name=AIRCRAFT_CHANGES_VIEW)
@dp.expect_all_or_fail(FAIL_EXPECTATIONS)
@dp.expect_all_or_drop(DROP_EXPECTATIONS)
@dp.expect_all(WARN_EXPECTATIONS)
def aircraft():
    return (
        spark.readStream
        .table(OPENSKY_ENRICHED_TABLE)
        .select("icao24", "category", "origin_country", "ingested_at")
        )


dp.create_streaming_table(name=AIRCRAFT_TABLE)

dp.create_auto_cdc_flow(
    target=AIRCRAFT_TABLE,
    source=AIRCRAFT_CHANGES_VIEW,
    keys=["icao24"],
    sequence_by="ingested_at",
)
