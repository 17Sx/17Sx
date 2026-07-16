#!/usr/bin/env node
/**
 * Generates deep-work-debt.svg from WakaTime (last 7 days).
 * debt = max(0, GOAL_HOURS - coded_hours)
 *
 * Env:
 *   WAKATIME_TOKEN          required
 *   DEEP_WORK_GOAL_HOURS    default 40
 *   OUTPUT_PATH             default deep-work-debt.svg
 */

import { writeFileSync } from "node:fs";

const token = process.env.WAKATIME_TOKEN;
const goalHours = Number(process.env.DEEP_WORK_GOAL_HOURS || "40");
const outputPath = process.env.OUTPUT_PATH || "deep-work-debt.svg";

if (!token) {
  console.error("WAKATIME_TOKEN is required");
  process.exit(1);
}

if (!Number.isFinite(goalHours) || goalHours <= 0) {
  console.error("DEEP_WORK_GOAL_HOURS must be a positive number");
  process.exit(1);
}

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}`).toString("base64")}`;
}

function formatHours(h) {
  if (h < 0.05) return "0h";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 0) return `${whole}h`;
  if (whole === 0) return `${mins}m`;
  return `${whole}h ${mins}m`;
}

function dayLabel(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchSummaries() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const url = `https://wakatime.com/api/v1/users/current/summaries?start=${startStr}&end=${endStr}`;

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(token),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WakaTime API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

function buildSvg({ days, totalHours, goalHours, debtHours, surplusHours }) {
  const width = 420;
  const height = 168;
  const chartX = 28;
  const chartY = 72;
  const chartW = 364;
  const chartH = 64;
  const maxHours = Math.max(goalHours / 7, ...days.map((d) => d.hours), 0.5);
  const barGap = 8;
  const barW = (chartW - barGap * (days.length - 1)) / days.length;
  const progress = Math.min(1, totalHours / goalHours);
  const progressW = Math.round(progress * 280);

  const bars = days
    .map((d, i) => {
      const h = Math.max(2, (d.hours / maxHours) * chartH);
      const x = chartX + i * (barW + barGap);
      const y = chartY + chartH - h;
      const label = dayLabel(d.date);
      return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#58a6ff" opacity="0.85"/>
      <text x="${(x + barW / 2).toFixed(1)}" y="${chartY + chartH + 14}" text-anchor="middle" fill="#8b949e" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${escapeXml(label)}</text>`;
    })
    .join("");

  const status =
    debtHours > 0
      ? `debt ${formatHours(debtHours)} remaining`
      : `cleared · surplus ${formatHours(surplusHours)}`;

  const statusColor = debtHours > 0 ? "#f85149" : "#3fb950";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Deep work debt">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="20" y="28" fill="#8b949e" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">deep work debt · 7d</text>
  <text x="20" y="52" fill="${statusColor}" font-size="18" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="600">${escapeXml(status)}</text>
  <text x="400" y="28" text-anchor="end" fill="#6e7681" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${escapeXml(formatHours(totalHours))} / ${escapeXml(formatHours(goalHours))}</text>
  <rect x="20" y="58" width="280" height="4" rx="2" fill="#21262d"/>
  <rect x="20" y="58" width="${progressW}" height="4" rx="2" fill="#58a6ff"/>
  ${bars}
  <text x="20" y="160" fill="#6e7681" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">goal − coded · auto · wakatime</text>
</svg>
`;
}

const data = await fetchSummaries();
const days = (data.data || []).map((entry) => ({
  date: entry.range?.date,
  hours: (entry.grand_total?.total_seconds || 0) / 3600,
}));

const totalHours = days.reduce((sum, d) => sum + d.hours, 0);
const debtHours = Math.max(0, goalHours - totalHours);
const surplusHours = Math.max(0, totalHours - goalHours);

const svg = buildSvg({ days, totalHours, goalHours, debtHours, surplusHours });
writeFileSync(outputPath, svg, "utf8");

console.log(
  `Wrote ${outputPath}: coded=${formatHours(totalHours)} goal=${formatHours(goalHours)} debt=${formatHours(debtHours)}`,
);
