import pytest

from app.routers.lakehouse import SAFE_QUERY_TEMPLATES, parse_query_plan


def test_approved_plan_is_parsed_without_executable_sql() -> None:
    plan = parse_query_plan('{"query_id":"investigation_status_summary","lookback_days":30}')

    assert plan.query_id == "investigation_status_summary"
    assert plan.lookback_days == 30
    statement, display_sql = SAFE_QUERY_TEMPLATES[plan.query_id]
    assert ":tenant_id" in statement.text
    assert ":lookback_days" in statement.text
    assert ":max_rows" in statement.text
    assert "tenant_id" in display_sql


@pytest.mark.parametrize(
    "raw_plan",
    [
        "SELECT * FROM investigations",
        '{"query_id":"unknown_table","lookback_days":30}',
        '{"query_id":"alert_severity_summary","lookback_days":366}',
        '{"query_id":"kyc_status_summary","lookback_days":30,"sql":"SELECT 1"}',
    ],
)
def test_rejects_model_output_outside_closed_analytics_plan_schema(raw_plan: str) -> None:
    with pytest.raises(ValueError, match="approved query plan"):
        parse_query_plan(raw_plan)
