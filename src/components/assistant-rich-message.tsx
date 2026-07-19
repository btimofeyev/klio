"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

const chartPointSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.number().finite(),
}).strict();

const chartSchema = z.object({
  title: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(12).optional(),
  series: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    values: z.array(chartPointSchema).min(2).max(12),
  }).strict()).min(1).max(4),
}).strict();

type AssistantChart = z.infer<typeof chartSchema>;

const markdownComponents: Components = {
  a: ({ href, children }) => <a href={safeHref(href)} target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noreferrer" : undefined}>{children}</a>,
  code: ({ className, children }) => {
    if (className === "language-chart") {
      const parsed = parseChart(String(children));
      return parsed ? <RichLineChart chart={parsed} /> : <span className="assistant-chart-error">This visual could not be displayed. The rest of Klio’s answer is still available.</span>;
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }) => <div className="assistant-code-block">{children}</div>,
  table: ({ children }) => <div className="assistant-table-scroll"><table>{children}</table></div>,
};

export function AssistantRichMessage({ content }: { content: string }) {
  return <div className="assistant-rich-message"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown></div>;
}

function RichLineChart({ chart }: { chart: AssistantChart }) {
  const width = 640;
  const height = 250;
  const plot = { left: 48, right: 18, top: 22, bottom: 42 };
  const allPoints = chart.series.flatMap((series) => series.values);
  const rawMin = Math.min(...allPoints.map((point) => point.value));
  const rawMax = Math.max(...allPoints.map((point) => point.value));
  const min = rawMin >= 0 ? 0 : Math.floor(rawMin / 10) * 10;
  const max = chart.unit === "%" && rawMax <= 100 ? 100 : Math.max(min + 1, Math.ceil(rawMax / 10) * 10);
  const labels = chart.series.reduce<string[]>((longest, series) => series.values.length > longest.length ? series.values.map((point) => point.label) : longest, []);
  const x = (index: number, count: number) => plot.left + (count === 1 ? 0 : index * (width - plot.left - plot.right) / (count - 1));
  const y = (value: number) => plot.top + (max - value) * (height - plot.top - plot.bottom) / (max - min);
  const colors = ["#506a54", "#9a664f", "#66737a", "#9b813f"];
  const ticks = Array.from({ length: 5 }, (_, index) => min + (max - min) * index / 4).reverse();

  return <figure className="assistant-chart" aria-label={chart.title}>
    <figcaption><strong>{chart.title}</strong><span>{chart.series.length === 1 ? chart.series[0].name : `${chart.series.length} series`}</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chart.title}>
      <title>{chart.title}</title>
      {ticks.map((tick) => {
        const tickY = y(tick);
        return <g key={tick}><line x1={plot.left} x2={width - plot.right} y1={tickY} y2={tickY} /><text x={plot.left - 9} y={tickY + 4} textAnchor="end">{formatChartValue(tick, chart.unit)}</text></g>;
      })}
      {labels.map((label, index) => <text className="assistant-chart-x-label" x={x(index, labels.length)} y={height - 13} textAnchor="middle" key={`${label}-${index}`}>{label}</text>)}
      {chart.series.map((series, seriesIndex) => {
        const points = series.values.map((point, index) => `${x(index, series.values.length)},${y(point.value)}`).join(" ");
        const color = colors[seriesIndex];
        return <g className="assistant-chart-series" style={{ color }} key={series.name}>
          <polyline points={points} />
          {series.values.map((point, index) => <g key={`${point.label}-${index}`}><circle cx={x(index, series.values.length)} cy={y(point.value)} r="4" /><title>{`${series.name}, ${point.label}: ${formatChartValue(point.value, chart.unit)}`}</title></g>)}
        </g>;
      })}
    </svg>
    {chart.series.length > 1 ? <div className="assistant-chart-legend">{chart.series.map((series, index) => <span style={{ "--chart-color": colors[index] } as React.CSSProperties} key={series.name}>{series.name}</span>)}</div> : null}
    <table className="visually-hidden"><caption>{chart.title}</caption><thead><tr><th>Series</th>{labels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr></thead><tbody>{chart.series.map((series) => <tr key={series.name}><th>{series.name}</th>{series.values.map((point, index) => <td key={`${point.label}-${index}`}>{formatChartValue(point.value, chart.unit)}</td>)}</tr>)}</tbody></table>
  </figure>;
}

function parseChart(value: string) {
  try { return chartSchema.parse(JSON.parse(value.trim())); }
  catch { return null; }
}

function safeHref(href: string | undefined) {
  if (!href) return undefined;
  if (href.startsWith("/app") || href.startsWith("https://") || href.startsWith("http://")) return href;
  return undefined;
}

function formatChartValue(value: number, unit = "") {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${formatted}${unit}`;
}
