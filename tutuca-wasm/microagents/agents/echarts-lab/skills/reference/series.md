# ECharts series and encode

| series type | encode keys | axes |
|---|---|---|
| `line`, `bar`, `scatter` | `x`, `y`, `tooltip`, `seriesName` | `xAxis` and `yAxis` (`category`, `value`, `time`, `log`) |
| `pie`, `funnel` | `itemName`, `value` | none |
| `heatmap` | `x`, `y`, `value` | two category axes plus `visualMap` |
| `boxplot`, `candlestick` | `x`, `y` (several columns) | category x |
| `radar` | data, not dataset | `radar.indicator` |

`encode` values are a column name or an array of names. For a horizontal bar chart, swap the
axes: `yAxis.type: "category"` and `encode: { "x": "value", "y": "name" }`.

Common options: `title.text`, `legend: {}`, `tooltip.trigger` (`item` or `axis`), `grid`
(margins), `series[].stack` (a stack name), `series[].smooth`, `series[].label.show`.
