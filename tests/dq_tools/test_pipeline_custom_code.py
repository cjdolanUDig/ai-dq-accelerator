"""Generated pipeline artifacts must embed the real custom transform code.

Regression: custom code lived only in the log entry's `custom_code` field, but
the generator read `params["code"]`, so downloads contained empty stubs."""
from dq_tools.pipeline_generator import _generate_python_pipeline


CUSTOM_CODE = "def transform(df):\n    df['flag'] = df['x'] > 0\n    return df"


def test_python_pipeline_embeds_custom_code_from_custom_code_field(tmp_path):
    log = [{
        "id": "step_9",
        "type": "custom",
        "params": {},  # code is NOT here — it's in custom_code
        "custom_code": CUSTOM_CODE,
        "rationale": "flag positive x",
        "status": "applied",
    }]
    _generate_python_pipeline(log, "sess", tmp_path)
    generated = (tmp_path / "transform.py").read_text()
    assert "df['flag'] = df['x'] > 0" in generated
    assert "flag positive x" in generated  # rationale used as description


def test_params_code_still_supported(tmp_path):
    log = [{
        "id": "step_1", "type": "custom",
        "params": {"code": CUSTOM_CODE, "description": "via params"},
        "status": "applied",
    }]
    _generate_python_pipeline(log, "sess", tmp_path)
    assert "df['flag'] = df['x'] > 0" in (tmp_path / "transform.py").read_text()
