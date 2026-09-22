from pyspark import pipelines as dp

FAIL_EXPECTATIONS = {}
DROP_EXPECTATIONS = {}
WARN_EXPECTATIONS = {}

@dp.temporary_view(name="aircraft_changes")
@dp.expect_all_or_fail(FAIL_EXPECTATIONS)
@dp.expect_all_or_drop(DROP_EXPECTATIONS)
@dp.expect_all(WARN_EXPECTATIONS)
def aircraft():
    return (
        spark.readStream
        .table("opensky_enriched")
        .select("icao24", "category", "origin_country", "ingested_at")
        )

dp.create_streaming_table(name="aircraft")

dp.create_auto_cdc_flow(
    target="aircraft",
    source="aircraft_changes",
    keys=["icao24"],
    sequence_by="ingested_at",
)