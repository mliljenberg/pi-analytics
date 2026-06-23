# Analytics Workflow Examples

Data analysis workflows default to DuckDB CLI, with Python used when it is better suited for a specific step, plus static HTML reports. No custom analytics tools are needed — pi uses `read`, `edit`, `bash`, and `write` for all data work.

## Prerequisites

- `duckdb` CLI available on `PATH`
- Python 3 available for post-processing
- `xdg-open` (Linux) or equivalent for opening HTML reports (optional)

## Table of Contents

1. [DuckDB CLI Queries](#1-duckdb-cli-queries) — Inspect, profile, and query data
2. [Python Analysis](#2-python-analysis) — Transform, validate, and visualize when Python fits better than SQL
3. [Static HTML Reports](#3-static-html-reports) — Self-contained deliverable reports

---

## 1. DuckDB CLI Queries

### Quick start: from a CSV file

Write an SQL file, execute it, and inspect results:

```sql
-- queries/sales_profile.sql
SELECT
  COUNT(*) AS row_count,
  MIN(order_date) AS first_order,
  MAX(order_date) AS last_order,
  COUNT(DISTINCT region) AS num_regions
FROM read_csv_auto('data/sales.csv');
```

```bash
duckdb -csv :memory: < queries/sales_profile.sql > output/sales_profile.csv
```

### Inspect schema before deep analysis

```sql
-- queries/inspect_schema.sql
DESCRIBE SELECT * FROM read_csv_auto('data/sales.csv');
```

```bash
duckdb -csv :memory: < queries/inspect_schema.sql > output/inspect_schema.csv
```

### Query with joins, aggregates, and window functions

```sql
-- queries/revenue_by_region.sql
SELECT
  region,
  SUM(revenue) AS total_revenue,
  COUNT(*) AS order_count,
  AVG(revenue) AS avg_order_value,
  SUM(revenue) OVER () AS grand_total,
  ROUND(SUM(revenue) * 100.0 / SUM(revenue) OVER (), 1) AS pct_of_total
FROM read_csv_auto('data/sales.csv')
GROUP BY region
ORDER BY total_revenue DESC;
```

```bash
duckdb -csv :memory: < queries/revenue_by_region.sql > output/revenue_by_region.csv
```

### Larger datasets: query from a persistent database

```bash
duckdb -csv analytics.db < queries/monthly_trends.sql > output/monthly_trends.csv
```

### JSON output for reports

```bash
duckdb -json analytics.db < queries/top_products.sql > output/top_products.json
```

### Error capture for diagnostics

```bash
duckdb -csv analytics.db < queries/experiment.sql > output/experiment.csv 2> output/experiment.err
test -s output/experiment.err && echo "Query had stderr" || echo "Clean"
```

### Common patterns

| Task | Command |
|------|---------|
| List tables | `duckdb -csv data.db "SHOW TABLES"` |
| Count rows | `duckdb -csv data.db "SELECT COUNT(*) FROM t"` |
| Export all from table | `duckdb -csv data.db "SELECT * FROM t" > out.csv` |
| Create table from CSV | `duckdb data.db "CREATE TABLE t AS SELECT * FROM read_csv_auto('d.csv')"` |
| Sample N rows | `duckdb -csv data.db "SELECT * FROM t USING SAMPLE 10"` |

---

## 2. Python Analysis

DuckDB is the default for data analysis. Use Python after DuckDB, or instead of it only when Python is better suited for the step.

### Transform CSV to JSON for reports

```python
# scripts/transform_to_json.py
import csv, json, sys

with open("output/revenue_by_region.csv", newline="") as source:
    rows = list(csv.DictReader(source))

payload = {
    "labels": [row["region"] for row in rows],
    "values": [float(row["total_revenue"]) for row in rows],
    "pct": [float(row["pct_of_total"]) for row in rows],
}

with open("output/revenue_by_region.json", "w") as target:
    json.dump(payload, target)

print(f"Wrote {len(rows)} regions to output/revenue_by_region.json")
```

```bash
python3 scripts/transform_to_json.py
```

### Statistical profiling

```python
# scripts/profile_distribution.py
import csv, statistics

with open("output/revenue_by_region.csv", newline="") as source:
    rows = list(csv.DictReader(source))

values = [float(row["total_revenue"]) for row in rows]

print(f"Count: {len(values)}")
print(f"Mean: {statistics.mean(values):.2f}")
print(f"Median: {statistics.median(values):.2f}")
print(f"Stdev: {statistics.stdev(values):.2f}")
print(f"Min: {min(values):.2f}")
print(f"Max: {max(values):.2f}")
```

### Validate output before report generation

```python
# scripts/validate.py
import csv, sys

with open(sys.argv[1], newline="") as f:
    rows = list(csv.DictReader(f))

if len(rows) == 0:
    print("ERROR: no data rows", file=sys.stderr)
    sys.exit(1)

column_names = rows[0].keys()
print(f"Columns: {', '.join(column_names)}")
print(f"Rows: {len(rows)}")
print("First row:", dict(rows[0]))
```

```bash
python3 scripts/validate.py output/revenue_by_region.csv
```

### Parquet support via DuckDB

```bash
# Convert Parquet to CSV for inspection
duckdb -csv :memory: "SELECT * FROM read_parquet('data/metrics.parquet') LIMIT 5" > output/metrics_sample.csv

# Parquet to DuckDB table
duckdb analytics.db "CREATE TABLE metrics AS SELECT * FROM read_parquet('data/metrics.parquet')"
```

---

## 3. Static HTML Reports

Self-contained HTML/JS/CSS reports that open directly in a browser — no server needed.

### Minimal dark-themed report with embedded data

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Revenue by Region</title>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --accent: #58a6ff; --green: #3fb950; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg); color: var(--text); padding: 2rem; max-width: 900px; margin: 0 auto;
  }
  h1 { color: var(--accent); margin-bottom: 0.5rem; }
  .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 2rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.65rem 0.75rem; border: 1px solid var(--border); text-align: left; }
  th { background: var(--surface); color: var(--accent); }
  tr:nth-child(even) { background: rgba(22,27,34,.5); }
  .bar-fill { height: 20px; background: var(--green); border-radius: 3px; transition: width 0.5s; }
  .bar-track { background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);
    color: #8b949e; font-size: 0.8rem; }
  @media (max-width: 600px) {
    body { padding: 1rem; }
    th, td { padding: 0.4rem 0.5rem; font-size: 0.9rem; }
  }
</style>
</head>
<body>
<h1>Revenue by Region</h1>
<p class="meta">June 2026 · Source: sales.csv · Query: revenue_by_region.sql</p>

<div id="content"></div>

<footer>Generated by Pi Analytics Agent · Reports/queries/sales_profile.sql · reports/output/revenue_by_region.csv</footer>

<script>
// Embedded data — replace with fetch() for larger datasets
const data = [
  { region: "North America", total_revenue: 2450000, pct_of_total: 42.5 },
  { region: "Europe", total_revenue: 1850000, pct_of_total: 32.1 },
  { region: "Asia Pacific", total_revenue: 980000, pct_of_total: 17.0 },
  { region: "Latin America", total_revenue: 320000, pct_of_total: 5.5 },
  { region: "Middle East", total_revenue: 165000, pct_of_total: 2.9 },
];

const maxRevenue = Math.max(...data.map(d => d.total_revenue));
const content = document.getElementById("content");

let table = "<table><thead><tr><th>Region</th><th>Revenue</th><th>% of Total</th><th>Share</th></tr></thead><tbody>";
for (const row of data) {
  table += `<tr>
    <td>${row.region}</td>
    <td>$${row.total_revenue.toLocaleString()}</td>
    <td>${row.pct_of_total}%</td>
    <td>
      <div class="bar-track"><div class="bar-fill" style="width:${(row.total_revenue/maxRevenue*100).toFixed(0)}%"></div></div>
    </td>
  </tr>`;
}
table += "</tbody></table>";
content.innerHTML = table;
</script>
</body>
</html>
```

### Report that fetches external data

```html
<script>
fetch("output/revenue_by_region.json")
  .then(r => r.json())
  .then(payload => renderChart(payload))
  .catch(err => {
    document.getElementById("content").innerHTML =
      `<p style="color:#f85149">Could not load data: ${err.message}</p>
       <p>Ensure <code>output/revenue_by_region.json</code> exists relative to this file.</p>`;
  });
</script>
```

### Canvas bar chart

```html
<canvas id="chart" width="800" height="400"></canvas>
<script>
const ctx = document.getElementById("chart").getContext("2d");
const labels = data.map(d => d.region);
const values = data.map(d => d.total_revenue);

// Draw bars with dark theme colors and labeled axes
// (see full example: analytics/04-canvas-chart.html)
</script>
```

### SVG donut chart

```html
<svg viewBox="0 0 200 200" width="200" height="200">
  <!-- Computed slices with percentages, centered labels, and hover states -->
  <!-- (see full example: analytics/05-svg-donut.html) -->
</svg>
```

### Generating and opening a report

```bash
xdg-open reports/revenue.html
```

### Report quality checklist

- Responsive layout (no fixed desktop width)
- Visible title, data source, generation timestamp
- Accessible contrast (dark theme with sufficient text contrast)
- Chart labels and tabular fallback for key values
- Graceful empty/error states when data is absent or malformed
- Touch-friendly controls on mobile
