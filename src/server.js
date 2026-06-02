// Tiny web server for the engagement dashboard, served on the public Heroku
// URL. Runs in the same process as the scheduler (single web dyno). Protected
// by HTTP basic auth; if credentials aren't configured the dashboard refuses to
// render so analytics are never accidentally public.

import express from "express";
import { getPostsForDashboard } from "./db.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const engagementOf = (p) =>
  (p.like_count || 0) + (p.reply_count || 0) + (p.retweet_count || 0);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Monday (UTC) of the week containing dateStr, as YYYY-MM-DD.
function weekStart(dateStr) {
  const d = new Date(dateStr);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday)
  );
  return monday.toISOString().slice(0, 10);
}

function aggregateBy(posts, keyFn) {
  const map = new Map();
  for (const p of posts) {
    const key = keyFn(p) || "unknown";
    const e = map.get(key) || { key, posts: 0, likes: 0, replies: 0, retweets: 0, engagement: 0 };
    e.posts += 1;
    e.likes += p.like_count || 0;
    e.replies += p.reply_count || 0;
    e.retweets += p.retweet_count || 0;
    e.engagement += engagementOf(p);
    map.set(key, e);
  }
  const arr = [...map.values()];
  for (const e of arr) e.avg = e.posts ? e.engagement / e.posts : 0;
  arr.sort((a, b) => b.engagement - a.engagement);
  return arr;
}

function bar(value, max) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar"><div class="fill" style="width:${pct}%"></div></div>`;
}

function leaderboard(title, rows, label) {
  if (rows.length === 0) return `<h2>${esc(title)}</h2><p class="muted">No data yet.</p>`;
  const max = rows[0].engagement;
  const body = rows
    .map(
      (r) => `<tr>
      <td>${esc(r.key)}</td>
      <td class="num">${r.posts}</td>
      <td class="num strong">${r.engagement}</td>
      <td class="num">${r.avg.toFixed(1)}</td>
      <td class="num">${r.likes}</td>
      <td class="num">${r.replies}</td>
      <td class="num">${r.retweets}</td>
      <td class="barcell">${bar(r.engagement, max)}</td>
    </tr>`
    )
    .join("");
  return `<h2>${esc(title)}</h2>
  <table>
    <thead><tr>
      <th>${esc(label)}</th><th class="num">Posts</th><th class="num">Engagement</th>
      <th class="num">Avg/post</th><th class="num">Likes</th><th class="num">Replies</th>
      <th class="num">RTs</th><th></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderDashboard(posts) {
  const totalPosts = posts.length;
  const totalEng = posts.reduce((s, p) => s + engagementOf(p), 0);
  const lastUpdated =
    posts.map((p) => p.metrics_updated_at).filter(Boolean).sort().pop() || null;

  const currentWeek = weekStart(new Date().toISOString());
  const thisWeekPosts = posts.filter((p) => weekStart(p.created_at) === currentWeek);

  const topicAll = aggregateBy(posts, (p) => p.topic);
  const topicWeek = aggregateBy(thisWeekPosts, (p) => p.topic);
  const styleAll = aggregateBy(posts, (p) => p.style);
  const kindAll = aggregateBy(posts, (p) => p.kind);

  // Per-week history with that week's best topic.
  const weeks = new Map();
  for (const p of posts) {
    const w = weekStart(p.created_at);
    const e = weeks.get(w) || { week: w, posts: 0, engagement: 0, byTopic: new Map() };
    e.posts += 1;
    e.engagement += engagementOf(p);
    e.byTopic.set((p.topic || "unknown"), (e.byTopic.get(p.topic || "unknown") || 0) + engagementOf(p));
    weeks.set(w, e);
  }
  const weekRows = [...weeks.values()]
    .sort((a, b) => b.week.localeCompare(a.week))
    .map((w) => {
      const top = [...w.byTopic.entries()].sort((a, b) => b[1] - a[1])[0];
      return `<tr>
        <td>${esc(w.week)}</td>
        <td class="num">${w.posts}</td>
        <td class="num strong">${w.engagement}</td>
        <td>${top ? esc(top[0]) : "—"}</td>
        <td class="num">${top ? top[1] : 0}</td>
      </tr>`;
    })
    .join("");

  const weekTable =
    weekRows.length === 0
      ? `<p class="muted">No data yet.</p>`
      : `<table><thead><tr><th>Week (Mon)</th><th class="num">Posts</th><th class="num">Engagement</th><th>Top topic</th><th class="num">Its engagement</th></tr></thead><tbody>${weekRows}</tbody></table>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engagement Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background:#0f1115; color:#e6e8ec; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 10px; color:#cfd3da; }
  .muted { color:#8b93a1; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin-top:14px; }
  .card { background:#171a21; border:1px solid #232833; border-radius:10px; padding:14px 16px; min-width:150px; }
  .card .v { font-size:24px; font-weight:700; }
  .card .l { font-size:12px; color:#8b93a1; text-transform:uppercase; letter-spacing:.04em; }
  table { width:100%; border-collapse:collapse; font-size:14px; background:#141821; border:1px solid #232833; border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid #20242e; }
  th { font-size:12px; color:#9aa3b2; font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric: tabular-nums; }
  .strong { font-weight:700; }
  .barcell { width:120px; }
  .bar { background:#222733; border-radius:5px; height:8px; width:110px; }
  .fill { background:linear-gradient(90deg,#3b82f6,#22d3ee); height:8px; border-radius:5px; }
  footer { margin-top:34px; color:#8b93a1; font-size:12px; }
</style></head>
<body><div class="wrap">
  <h1>Engagement Dashboard</h1>
  <div class="muted">Last ${config.dashboard.weeks} weeks · engagement = likes + replies + retweets</div>

  <div class="cards">
    <div class="card"><div class="v">${totalPosts}</div><div class="l">Posts</div></div>
    <div class="card"><div class="v">${totalEng}</div><div class="l">Total engagement</div></div>
    <div class="card"><div class="v">${thisWeekPosts.length}</div><div class="l">Posts this week</div></div>
    <div class="card"><div class="v">${topicWeek[0] ? esc(topicWeek[0].key) : "—"}</div><div class="l">Top topic this week</div></div>
  </div>

  ${leaderboard("This week — by topic", topicWeek, "Topic")}
  ${leaderboard(`Top topics — last ${config.dashboard.weeks} weeks`, topicAll, "Topic")}
  ${leaderboard("By style", styleAll, "Style")}
  ${leaderboard("News vs evergreen", kindAll, "Kind")}

  <h2>Weekly history</h2>
  ${weekTable}

  <footer>
    Engagement refreshed daily from the X API${lastUpdated ? ` · last updated ${esc(lastUpdated)}` : " · not refreshed yet"}.
    New posts start at 0 until the next refresh.
  </footer>
</div></body></html>`;
}

function basicAuth(req, res, next) {
  const { user, pass } = config.dashboard;
  if (!user || !pass) {
    res.status(503).send("Dashboard not configured. Set DASHBOARD_USER and DASHBOARD_PASS.");
    return;
  }
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, p] = Buffer.from(encoded, "base64").toString().split(":");
    if (u === user && p === pass) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Dashboard"').status(401).send("Authentication required.");
}

export function startServer() {
  const app = express();

  // Unauthenticated health check (for uptime monitors).
  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.get("/", (req, res) => res.redirect("/dashboard"));

  app.get("/dashboard", basicAuth, async (req, res) => {
    try {
      const posts = await getPostsForDashboard(config.dashboard.weeks * 7);
      res.set("Content-Type", "text/html; charset=utf-8").send(renderDashboard(posts));
    } catch (err) {
      logger.error({ error: err.message, stack: err.stack }, "Dashboard render failed");
      res.status(500).send("Error generating dashboard.");
    }
  });

  const server = app.listen(config.dashboard.port, () => {
    logger.info(
      { port: config.dashboard.port, authConfigured: !!(config.dashboard.user && config.dashboard.pass) },
      "Dashboard server listening"
    );
  });
  return server;
}
