# Stronger Cross-Column Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce more and better notebook charts for cross-column findings — reliably using agent-emitted matplotlib code when safe, and a dtype-aware fallback chart otherwise — staying in the existing pre-executed-notebook / static-HTML architecture.

**Architecture:** Strengthen the investigation prompt so each cross-column finding emits `visualization_code`; add a safety gate before embedding agent code; replace the single generic cross-column fallback with a runtime dtype-aware chart builder that picks scatter / heatmap / grouped-box / time-series based on the two columns' dtypes.

**Tech Stack:** Python, matplotlib, nbformat/nbconvert, pytest (`asyncio_mode=auto`).

Spec: `docs/superpowers/specs/2026-05-27-cross-column-visualizations-design.md`

---

## File Structure

- `backend/agents/prompts.py` — require `visualization_code` for cross-column findings.
- `backend/agents/graphs/exploration_notebook.py` — add `_is_safe_viz`, replace `_cross_column_viz_cell` with a dtype-aware builder, gate agent code at the two embed sites (column findings ~line 286, cross-column ~line 321).
- `tests/backend/test_exploration_notebook.py` — extend (existing file).

Tests run with `uv run pytest`.

---

## Task 1: Visualization-code safety gate

**Files:**
- Modify: `backend/agents/graphs/exploration_notebook.py` (add helper near the top, after imports)
- Test: `tests/backend/test_exploration_notebook.py`

The notebook is pre-executed, so unsafe agent code (file I/O, imports, os) runs in the kernel. Add the same unsafe-pattern discipline used by the custom-code generator.

- [ ] **Step 1: Write the failing test**

Append to `tests/backend/test_exploration_notebook.py`:

```python
from backend.agents.graphs.exploration_notebook import _is_safe_viz


def test_is_safe_viz_blocks_unsafe_code():
    assert _is_safe_viz("import os\nos.system('rm -rf /')") is False
    assert _is_safe_viz("open('/etc/passwd').read()") is False
    assert _is_safe_viz("eval('2+2')") is False
    assert _is_safe_viz("") is False


def test_is_safe_viz_allows_plotting_code():
    code = (
        "_col = df.columns[0]\n"
        "df[_col].value_counts().head(10).plot(kind='bar')\n"
        "plt.tight_layout()"
    )
    assert _is_safe_viz(code) is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_exploration_notebook.py -k is_safe_viz -v`
Expected: FAIL — `cannot import name '_is_safe_viz'`.

- [ ] **Step 3: Implement `_is_safe_viz`**

Add near the top of `backend/agents/graphs/exploration_notebook.py` (after the imports):

```python
import re as _re

_UNSAFE_VIZ_PATTERNS = [
    r"\bimport\b", r"\bopen\s*\(", r"\bos\.", r"\bsys\.", r"\bsubprocess\b",
    r"\beval\s*\(", r"\bexec\s*\(", r"__import__", r"\bbuiltins\b",
    r"\bto_csv\b", r"\bto_parquet\b", r"\bwrite\s*\(",
]


def _is_safe_viz(code: str) -> bool:
    """True if agent-supplied visualization code is safe to embed and execute."""
    if not code or not code.strip():
        return False
    return not any(_re.search(p, code) for p in _UNSAFE_VIZ_PATTERNS)
```

If `re` is already imported at module top, use it directly and drop the `import re as _re` alias (avoid a duplicate import — check the existing imports first).

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_exploration_notebook.py -k is_safe_viz -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Lint + commit**

```bash
ruff check backend/agents/graphs/exploration_notebook.py tests/backend/test_exploration_notebook.py
git add backend/agents/graphs/exploration_notebook.py tests/backend/test_exploration_notebook.py
git commit -m "feat(notebook): add safety gate for agent-supplied visualization code"
```

---

## Task 2: Dtype-aware cross-column fallback builder

**Files:**
- Modify: `backend/agents/graphs/exploration_notebook.py` (`_cross_column_viz_cell`, lines 109-128)
- Test: `tests/backend/test_exploration_notebook.py`

The fallback runs whenever the agent did not supply safe viz code. It must resolve the two columns at runtime (case-insensitive, matching the existing prompt convention) and pick a chart by dtype: numeric×numeric → scatter, cat×cat → crosstab heatmap, numeric×cat → grouped box, datetime×anything → time series. The cell is a self-contained string executed in the kernel where `df`, `con`, `plt`, `pd`, `np` are in scope.

- [ ] **Step 1: Write the failing test**

The builder returns a code string; the test asserts the string compiles and references the expected chart branches.

Append to `tests/backend/test_exploration_notebook.py`:

```python
import ast

from backend.agents.graphs.exploration_notebook import _cross_column_viz_cell


def test_cross_column_viz_cell_is_valid_python():
    code = _cross_column_viz_cell(1, ["age", "income"], "SELECT age, income FROM working_data")
    ast.parse(code)  # raises SyntaxError if malformed


def test_cross_column_viz_cell_covers_dtype_branches():
    code = _cross_column_viz_cell(1, ["age", "income"], None)
    # Dtype-aware branches must be present
    assert "is_numeric_dtype" in code
    assert "scatter" in code
    assert "crosstab" in code
    # Case-insensitive column resolution (matches prompt convention)
    assert ".lower()" in code


def test_cross_column_viz_cell_handles_single_column():
    # Builder must not crash when given fewer than 2 columns
    code = _cross_column_viz_cell(1, ["age"], None)
    ast.parse(code)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/backend/test_exploration_notebook.py -k cross_column_viz_cell -v`
Expected: FAIL — current builder lacks `crosstab` / `is_numeric_dtype` / `.lower()`.

- [ ] **Step 3: Replace `_cross_column_viz_cell`**

Replace the existing function (lines 109-128) with a dtype-aware builder. It resolves up to two columns case-insensitively, then branches on dtype:

```python
def _cross_column_viz_cell(finding_idx: int, cols: list, sql) -> str:
    """Dtype-aware cross-column chart, chosen at runtime from the two columns.

    numeric×numeric → scatter; categorical×categorical → crosstab heatmap;
    numeric×categorical → grouped box; datetime present → time series.
    Falls back to printing the SQL result if columns cannot be resolved.
    """
    title = f"Cross-column finding {finding_idx}: {' x '.join(cols)}"
    col_a = cols[0] if len(cols) >= 1 else ""
    col_b = cols[1] if len(cols) >= 2 else ""
    return f"""# {title}
import pandas as _pd
_names = [{col_a!r}, {col_b!r}]
_resolved = [next((c for c in df.columns if c.lower() == n.lower()), None) for n in _names if n]
_resolved = [c for c in _resolved if c is not None]
if len(_resolved) < 2:
    if {col_a!r} and {col_a!r}.lower() in [c.lower() for c in df.columns]:
        _c = next(c for c in df.columns if c.lower() == {col_a!r}.lower())
        df[_c].value_counts().head(20).plot(kind='bar', figsize=(12, 5), color='steelblue')
        plt.title({title!r})
        plt.tight_layout()
    else:
        print("Could not resolve columns for visualization: {col_a} x {col_b}")
else:
    _a, _b = _resolved[0], _resolved[1]
    _sa, _sb = df[_a], df[_b]
    _num_a = _pd.api.types.is_numeric_dtype(_sa)
    _num_b = _pd.api.types.is_numeric_dtype(_sb)
    _dt_a = _pd.api.types.is_datetime64_any_dtype(_sa)
    _dt_b = _pd.api.types.is_datetime64_any_dtype(_sb)
    fig, ax = plt.subplots(figsize=(12, 5))
    if _dt_a or _dt_b:
        # Time series: aggregate the other column over the date column
        _tcol, _vcol = (_a, _b) if _dt_a else (_b, _a)
        _tmp = df[[_tcol, _vcol]].dropna().copy()
        _tmp[_tcol] = _pd.to_datetime(_tmp[_tcol], errors='coerce')
        _tmp = _tmp.dropna(subset=[_tcol]).set_index(_tcol).sort_index()
        if _pd.api.types.is_numeric_dtype(_tmp[_vcol]):
            _tmp[_vcol].resample('ME').mean().plot(ax=ax)
            ax.set_ylabel(f"mean {{_vcol}}")
        else:
            _tmp.groupby([_pd.Grouper(freq='ME'), _vcol]).size().unstack(fill_value=0).plot.area(ax=ax)
        ax.set_title({title!r})
    elif _num_a and _num_b:
        ax.scatter(_sa, _sb, s=8, alpha=0.4, color='steelblue')
        ax.set_xlabel(_a); ax.set_ylabel(_b)
        ax.set_title({title!r} + " (scatter)")
    elif _num_a != _num_b:
        _ccol, _ncol = (_b, _a) if _num_a else (_a, _b)
        _top = df[_ccol].value_counts().head(12).index
        _data = [df.loc[df[_ccol] == g, _ncol].dropna() for g in _top]
        ax.boxplot(_data, labels=[str(g) for g in _top])
        ax.set_xlabel(_ccol); ax.set_ylabel(_ncol)
        ax.set_title({title!r} + " (distribution by group)")
        plt.xticks(rotation=45, ha='right')
    else:
        _ct = _pd.crosstab(_sa, _sb)
        _ct = _ct.iloc[:12, :12]
        im = ax.imshow(_ct.values, cmap='Blues', aspect='auto')
        ax.set_xticks(range(len(_ct.columns))); ax.set_xticklabels(_ct.columns, rotation=45, ha='right', fontsize=7)
        ax.set_yticks(range(len(_ct.index))); ax.set_yticklabels(_ct.index, fontsize=7)
        plt.colorbar(im, ax=ax, shrink=0.8)
        ax.set_title({title!r} + " (crosstab)")
    plt.tight_layout()""".strip()
```

Note the cell does **not** call `plt.show()` — the prompt convention and existing column-finding cells rely on Jupyter auto-rendering the final figure during pre-execution. (The old fallback called `plt.show()`; the per-column cells do not. Match the per-column convention so it renders consistently in the exported HTML.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/backend/test_exploration_notebook.py -k cross_column_viz_cell -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Lint + commit**

```bash
ruff check backend/agents/graphs/exploration_notebook.py tests/backend/test_exploration_notebook.py
git add backend/agents/graphs/exploration_notebook.py tests/backend/test_exploration_notebook.py
git commit -m "feat(notebook): dtype-aware cross-column fallback charts (scatter/heatmap/box/timeseries)"
```

---

## Task 3: Gate agent viz code at both embed sites

**Files:**
- Modify: `backend/agents/graphs/exploration_notebook.py` (`_build_notebook`, lines 285-292 and 321-325)

Currently agent `visualization_code` is embedded unconditionally when present. Route it through `_is_safe_viz`; on failure, fall back to the dtype-aware builder (cross-column) or the distribution cell (per-column).

- [ ] **Step 1: Gate the per-column visualization (lines 285-292)**

Replace:

```python
        # Visualization — prefer AI-generated code, fall back to generic chart
        viz_code = cf.get("visualization_code", "").strip()
        if viz_code:
            cells.append(new_code_cell(viz_code))
        else:
            cells.append(new_code_cell(
                _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
            ))
```

with:

```python
        # Visualization — prefer SAFE AI-generated code, else generic chart
        viz_code = cf.get("visualization_code", "").strip()
        if viz_code and _is_safe_viz(viz_code):
            cells.append(new_code_cell(viz_code))
        else:
            cells.append(new_code_cell(
                _distribution_cell(column, cf.get("data_type_actual", "text"), issues)
            ))
```

- [ ] **Step 2: Gate the cross-column visualization (lines 321-325)**

Replace:

```python
            viz_code = finding.get("visualization_code", "").strip()
            if viz_code:
                cells.append(new_code_cell(viz_code))
            elif finding.get("investigation_sql"):
                cells.append(new_code_cell(_cross_column_viz_cell(i, cols, finding["investigation_sql"])))
```

with:

```python
            viz_code = finding.get("visualization_code", "").strip()
            if viz_code and _is_safe_viz(viz_code):
                cells.append(new_code_cell(viz_code))
            else:
                cells.append(new_code_cell(
                    _cross_column_viz_cell(i, cols, finding.get("investigation_sql"))
                ))
```

This also ensures every cross-column finding gets a chart even when it has no `investigation_sql` (the builder works from `cols` alone).

- [ ] **Step 3: Order cross-column findings by severity**

In the cross-column section (line 303-306), sort findings so critical charts appear first. Replace:

```python
    cross = exploration_findings.get("cross_column_findings", [])
    if cross:
        cells.append(new_markdown_cell("---\n\n## Cross-Column Findings"))
        for i, finding in enumerate(cross, 1):
```

with:

```python
    cross = exploration_findings.get("cross_column_findings", [])
    if cross:
        _sev_rank = {"critical": 0, "warning": 1, "info": 2}
        cross = sorted(cross, key=lambda f: _sev_rank.get(f.get("severity", "info"), 3))
        cells.append(new_markdown_cell("---\n\n## Cross-Column Findings"))
        for i, finding in enumerate(cross, 1):
```

- [ ] **Step 4: Verify the module imports cleanly**

Run: `uv run python -c "import backend.agents.graphs.exploration_notebook"`
Expected: exits 0.

- [ ] **Step 5: Lint + commit**

```bash
ruff check backend/agents/graphs/exploration_notebook.py
git add backend/agents/graphs/exploration_notebook.py
git commit -m "feat(notebook): gate agent viz code through safety check; order findings by severity"
```

---

## Task 4: Require visualization_code in the prompt

**Files:**
- Modify: `backend/agents/prompts.py` (cross-column finding schema, lines 72-84; guidelines, lines 96-127)

- [ ] **Step 1: Make `visualization_code` required for cross-column findings**

In the `===CROSS_COLUMN_FINDING_START===` schema block (lines 74-84), change the `visualization_code` line and add an emphasis line just before the closing marker:

```
  "rule_implications": ["<direction for a DQ rule>"],
  "visualization_code": "<REQUIRED for cross-column findings — matplotlib code per the guidelines below. Never null.>"
}
===CROSS_COLUMN_FINDING_END===
```

- [ ] **Step 2: Add a cross-column emphasis line to the guidelines**

In the `### visualization_code guidelines` section (after line 127, the group-over-time bullet), add:

```
**For every cross-column finding you MUST emit visualization_code** that shows the relationship between the two columns — a scatter for numeric×numeric, a grouped bar/box for numeric×categorical, a heatmap or grouped bars for categorical×categorical, or a time series when a date column is involved. Resolve both columns case-insensitively. If you genuinely cannot chart it, set investigation_sql so the notebook can render a fallback.
```

- [ ] **Step 3: Verify prompts import**

Run: `uv run python -c "from backend.agents.prompts import PROFILE_INVESTIGATE_SYSTEM" 2>/dev/null || uv run python -c "import backend.agents.prompts"`
Expected: exits 0. (Use the actual constant name for the investigation system prompt — confirm by grepping the file.)

- [ ] **Step 4: Commit**

```bash
git add backend/agents/prompts.py
git commit -m "feat(prompts): require visualization_code for cross-column findings"
```

---

## Task 5: Notebook build smoke test + regression

**Files:**
- Test: `tests/backend/test_exploration_notebook.py`

- [ ] **Step 1: Add an end-to-end build test that exercises the fallback**

This verifies the notebook builds (cells assemble) for a cat×cat finding with no `visualization_code`, using the existing `_build_notebook` entry point. Append:

```python
from backend.agents.graphs.exploration_notebook import _build_notebook


def test_build_notebook_includes_fallback_cross_column_chart():
    findings = {
        "column_findings": [],
        "cross_column_findings": [
            {
                "columns": ["EmployeeGroup", "Department"],
                "full_analysis": "Group/department mismatch.",
                "pattern": "mismatch",
                "severity": "critical",
                "investigation_sql": None,
                "rule_implications": ["Standardize EmployeeGroup"],
                # no visualization_code → fallback builder must run
            }
        ],
    }
    nb = _build_notebook("sess1", findings, "raw notes")
    code_sources = [c["source"] for c in nb["cells"] if c["cell_type"] == "code"]
    assert any("crosstab" in src for src in code_sources)
```

- [ ] **Step 2: Run the new test**

Run: `uv run pytest tests/backend/test_exploration_notebook.py::test_build_notebook_includes_fallback_cross_column_chart -v`
Expected: PASS.

- [ ] **Step 3: Run the whole notebook test module**

Run: `uv run pytest tests/backend/test_exploration_notebook.py -v`
Expected: all pass (existing + new).

- [ ] **Step 4: Run the full backend suite**

Run: `uv run pytest tests/backend -q`
Expected: no NEW failures vs. the pre-existing baseline.

- [ ] **Step 5: Lint + commit**

```bash
ruff check tests/backend/test_exploration_notebook.py
git add tests/backend/test_exploration_notebook.py
git commit -m "test(notebook): cover dtype-aware cross-column fallback in notebook build"
```

---

## Optional manual verification (recommended, not gated)

Pre-executing a notebook requires a real session DuckDB. If one is available locally, generate a notebook end-to-end and open the HTML to confirm charts render:

```bash
uv run python -c "
from backend.agents.graphs.exploration_notebook import generate_exploration_notebook
# use an existing session id with a working.duckdb
nb, html = generate_exploration_notebook('<SESSION_ID>', {'cross_column_findings': [...]}, 'notes')
print(html)
"
```

Open `output/sessions/<SESSION_ID>/exploration_notebook.html` and confirm the cross-column charts render and are ordered critical-first.

---

## Self-Review Notes (for the implementer)

- Safety gate (`_is_safe_viz`) mirrors `custom_code_generator._UNSAFE_PATTERNS` plus file-write patterns, since this code is pre-executed in the kernel.
- The fallback builder works from `cols` alone, so removing the old `elif finding.get("investigation_sql")` guard means **every** cross-column finding now gets a chart.
- No `plt.show()` in the fallback — matches the per-column distribution cells so HTML export renders the figure.
- Frontend is untouched: the iframe still renders the pre-executed HTML, per the spec's explicit deferral of interactive charts.
