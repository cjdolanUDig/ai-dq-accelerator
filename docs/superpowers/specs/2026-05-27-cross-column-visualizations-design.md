# Stronger Cross-Column Visualizations — Design

**Date:** 2026-05-27
**Status:** Approved for planning

## Problem

The exploration notebook is matplotlib-only, pre-executed, and exported to
static HTML rendered in a frontend iframe
(`backend/agents/graphs/exploration_notebook.py`). Cross-column findings carry
an optional `visualization_code` field, but the agent emits it inconsistently,
so most cross-column cells fall back to a generic bar chart
(`_cross_column_viz_cell()`). Cross-column relationships — the most insight-rich
findings — are under-visualized.

## Goal

More and better charts, especially for cross-column findings, while staying in
the existing matplotlib / pre-executed-notebook architecture (no frontend
rendering change).

## Current Behavior (as-is)

- `exploration_notebook.py` builds an `.ipynb` via `nbformat`, pre-executes it
  with `ExecutePreprocessor`, and exports HTML with `nbconvert`.
- Existing charts: missing-values bar, numeric correlation heatmap, per-column
  histogram / value-counts bar, and a generic 2-column fallback
  (`_cross_column_viz_cell()` `:109-128`).
- Cross-column findings come from `deep_investigate.py` tools backed by
  `dq_tools/cross_column.py`: `pairwise_profile` (numeric×numeric Pearson +
  decile bands; cat×cat crosstab; numeric×cat group stats), `group_over_time`
  (categorical value distribution across time bins), `find_correlated_nulls`,
  `compute_correlation_matrix`.
- Finding schema (`backend/agents/prompts.py:74-84`) includes
  `columns`, `pattern`, `severity`, `investigation_sql`, `rule_implications`,
  `visualization_code`.
- The agent can emit `visualization_code`; if present it becomes a raw code
  cell, else the generic fallback runs.

## Design

### 1. Reliable per-finding visualization code

- Strengthen the investigation system prompt (`prompts.py`) to **require**
  `visualization_code` for each cross-column finding, with guidance: use
  matplotlib only, read from the `working_data` DataFrame already in scope,
  label axes, and key the chart to the finding's columns/pattern.
- Sanitize the agent-supplied code before embedding, reusing the same
  unsafe-pattern discipline as custom transforms (no `import`, `open`, `os`,
  `eval`, `exec`, etc.). Unsafe or empty code → fall back (see #2).

### 2. Dtype-aware fallback chart builders

Replace the single generic fallback in `exploration_notebook.py` with builders
chosen by the finding's column dtypes, fed by `dq_tools/cross_column.py`:

- **numeric × numeric** → scatter with decile bands (from `pairwise_profile`).
- **categorical × categorical** → crosstab heatmap.
- **numeric × categorical** → grouped box/bar of the numeric per category.
- **time × categorical** → stacked area of value distribution over time bins
  (from `group_over_time`).

These run whenever `visualization_code` is absent or fails sanitization, so
every cross-column finding gets a meaningful chart.

### 3. Findings ordering

Render the "Cross-Column Findings" section ordered by `severity`
(critical → warning → info) so the most important charts appear first.

## Components Touched

- `backend/agents/prompts.py` — require `visualization_code`; matplotlib
  guidance in the `CROSS_COLUMN_FINDING` schema.
- `backend/agents/graphs/exploration_notebook.py` — dtype-aware fallback
  builders; sanitize agent viz code before embedding; severity ordering.
- `dq_tools/cross_column.py` — expose decile / group-stat data if not already
  returned in a form the builders can consume (likely minor).

## Error Handling

- Agent viz code that fails sanitization or raises during pre-execution must
  not break the notebook build: catch, drop the bad cell, and substitute the
  dtype-aware fallback.
- `ExecutePreprocessor` already has a 300s timeout; keep per-chart work bounded
  (cap categories/points rendered, e.g. top-N).

## Testing (extends `test_exploration_notebook.py`)

- A cat×cat finding renders a crosstab heatmap.
- A numeric×numeric finding renders a scatter with decile bands.
- A time×cat finding renders a stacked-area-over-time chart.
- Malformed/unsafe agent `visualization_code` is rejected and the fallback
  builder runs instead; the notebook still builds and exports HTML.
- Findings render ordered by severity.

## Out of Scope

- Interactive frontend charts (plotly/React) — explicitly deferred; the
  notebook stays pre-executed server-side.
- Re-generating the notebook on user interaction.
