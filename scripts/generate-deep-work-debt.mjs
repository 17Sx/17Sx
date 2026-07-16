#!/usr/bin/env node
/**
 * Generates deep-work-debt.svg from WakaTime (last 7 days).
 * debt = max(0, GOAL_HOURS - coded_hours)
 *
 * Env:
 *   WAKATIME_TOKEN          required (or in local .env)
 *   DEEP_WORK_GOAL_HOURS    default 40
 *   OUTPUT_PATH             default deep-work-debt.svg
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const token = process.env.WAKATIME_TOKEN;
const goalHours = Number(process.env.DEEP_WORK_GOAL_HOURS || "40");
const outputPath = process.env.OUTPUT_PATH || "deep-work-debt.svg";

if (!token) {
  console.error("WAKATIME_TOKEN is required (set env or add it to .env)");
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

function dayLetter(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "narrow",
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

function contribGreen(hours, maxHours) {
  // Same ladder as GitHub / isocalendar contribution graph
  if (hours <= 0) return "#ebedf0";
  const t = hours / maxHours;
  if (t < 0.25) return "#9be9a8";
  if (t < 0.5) return "#40c463";
  if (t < 0.75) return "#30a14e";
  return "#216e39";
}

function buildSvg({ days, totalHours, goalHours, debtHours, surplusHours }) {
  const width = 480;
  const height = 120;
  const font =
    "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  // Contribution greens (isocalendar)
  const green = "#30a14e";
  const greenDeep = "#216e39";
  const empty = "#ebedf0";

  const cleared = debtHours <= 0;
  const accent = cleared ? greenDeep : green;
  const metricLabel = cleared ? "SURPLUS" : "DEBT";
  const metricValue = formatHours(cleared ? surplusHours : debtHours);
  const ratio = Math.min(1, totalHours / goalHours);
  const pct = Math.round(ratio * 100);

  // Sparkline geometry
  const sx = 208;
  const sy = 42;
  const sw = 248;
  const sh = 48;
  const maxH = Math.max(...days.map((d) => d.hours), goalHours / 7, 0.25);
  const goalY = sy + sh - (goalHours / 7 / maxH) * sh;

  const points = days.map((d, i) => {
    const x =
      days.length === 1 ? sx + sw / 2 : sx + (i / (days.length - 1)) * sw;
    const y = sy + sh - (d.hours / maxH) * sh;
    return {
      x,
      y,
      hours: d.hours,
      label: dayLetter(d.date),
      color: contribGreen(d.hours, maxH),
    };
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${sx},${(sy + sh).toFixed(1)} ${polyline} ${(sx + sw).toFixed(1)},${(sy + sh).toFixed(1)}`;

  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.75" fill="${p.color}" stroke="#ffffff" stroke-width="0.75"/>`,
    )
    .join("");

  const labels = points
    .map(
      (p) =>
        `<text x="${p.x.toFixed(1)}" y="${sy + sh + 14}" text-anchor="middle" fill="#777777" font-size="10" font-family="${mono}">${escapeXml(p.label)}</text>`,
    )
    .join("");

  const trackW = 168;
  const fillW = Math.max(2, Math.round(trackW * ratio));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Deep work debt">
  <style>
    @keyframes dw-draw { from { stroke-dashoffset: 400 } to { stroke-dashoffset: 0 } }
    @keyframes dw-fade { from { opacity: 0 } to { opacity: 1 } }
    .dw-line { stroke-dasharray: 400; animation: dw-draw 1.1s ease forwards }
    .dw-fade { opacity: 0; animation: dw-fade .6s ease .3s forwards }
  </style>

  <!-- transparent background (like metrics plugins) -->

  <!-- header -->
  <svg x="16" y="14" width="16" height="16" viewBox="0 0 16 16" fill="#0366d6">
    <path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zm.5 4.75a.75.75 0 00-1.5 0v3.5a.75.75 0 00.471.696l2.5 1a.75.75 0 00.557-1.392L8.5 7.742V4.75z"/>
  </svg>
  <text x="40" y="27" fill="#0366d6" font-size="16" font-weight="400" font-family="${font}">Deep work debt</text>
  <text x="464" y="27" text-anchor="end" fill="#777777" font-size="12" font-family="${mono}">7d</text>

  <!-- metric -->
  <text x="16" y="58" fill="#777777" font-size="11" letter-spacing="1.2" font-family="${mono}">${metricLabel}</text>
  <text x="16" y="84" fill="${accent}" font-size="28" font-weight="600" font-family="${mono}">${escapeXml(metricValue)}</text>
  <text x="16" y="104" fill="#777777" font-size="12" font-family="${mono}">${escapeXml(formatHours(totalHours))}/${escapeXml(formatHours(goalHours))} · ${pct}%</text>

  <!-- progress -->
  <rect x="16" y="112" width="${trackW}" height="2" rx="1" fill="${empty}"/>
  <rect x="16" y="112" width="${fillW}" height="2" rx="1" fill="${accent}" class="dw-fade"/>

  <!-- sparkline -->
  <line x1="${sx}" y1="${goalY.toFixed(1)}" x2="${(sx + sw).toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="${empty}" stroke-width="1" stroke-dasharray="3 3"/>
  <polygon points="${area}" fill="${green}" opacity="0.12" class="dw-fade"/>
  <polyline points="${polyline}" fill="none" stroke="${green}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="dw-line"/>
  <g class="dw-fade">${dots}</g>
  ${labels}
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
