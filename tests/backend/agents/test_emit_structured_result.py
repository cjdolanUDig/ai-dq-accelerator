from backend.agents.graphs.deep_investigate import _result_payload


def test_result_payload_parses_json_string():
    payload = _result_payload('{"total_rows": 70000, "null_count": 0}')
    assert payload == {"total_rows": 70000, "null_count": 0}


def test_result_payload_caps_parsed_list():
    raw = "[" + ",".join("0" for _ in range(200)) + "]"
    payload = _result_payload(raw)
    assert isinstance(payload, list)
    assert len(payload) == 50  # capped by cap_result default


def test_result_payload_passthrough_non_json_string():
    payload = _result_payload("not json at all")
    assert payload == "not json at all"
