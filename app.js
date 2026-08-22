/* Live StockCharts-style watchlist. Fetches daily OHLCV in the browser. */
"use strict";

export const COLORS = {
  UP_BAR: "#1565C0",
  DOWN_BAR: "#C62828",
  EMA5: "#1565C0",
  EMA10: "#D32F2F",
  SMA50: "#2E7D32",
  SMA200: "#8E24AA",
  RSI_LINE: "#212121",
  RSI_BAND: "#C5E1A5",
  RSI_REF: "#B0BEC5",
  MACD_LINE: "#1565C0",
  MACD_SIGNAL: "#D32F2F",
  MACD_HIST_POS: "#26A69A",
  MACD_HIST_NEG: "#EF5350",
  FI_POS: "#66BB6A",
  FI_NEG: "#EF9A9A",
  FI_LINE: "#37474F",
  VOLUME: "#90A4AE",
  GRID: "#E6E6E6",
  MONTH_GRID: "#EEEEEE",
  SPINE: "#B0BEC5",
  TEXT: "#212121",
  MUTED: "#546E7A",
  ZERO: "#78909C",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NY_TZ = "America/New_York";

/* ---------- math / indicators (match chart.py) ---------- */

export function nanmean(arr) {
  let s = 0, c = 0;
  for (const v of arr) {
    if (Number.isFinite(v)) { s += v; c++; }
  }
  return c ? s / c : NaN;
}

export function sma(arr, window) {
  const n = arr.length;
  const out = new Array(n).fill(NaN);
  if (n < window) return out;
  let s = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) { s += v; valid++; }
    if (i >= window) {
      const old = arr[i - window];
      if (Number.isFinite(old)) { s -= old; valid--; }
    }
    if (i >= window - 1 && valid === window) out[i] = s / window;
  }
  return out;
}

export function ema(arr, span) {
  const n = arr.length;
  const out = new Array(n).fill(NaN);
  if (n < span) return out;
  const seed = nanmean(arr.slice(0, span));
  if (!Number.isFinite(seed)) return out;
  out[span - 1] = seed;
  const alpha = 2 / (span + 1);
  let prev = seed;
  for (let i = span; i < n; i++) {
    const val = arr[i];
    if (!Number.isFinite(val)) {
      out[i] = prev;
      continue;
    }
    prev = prev * (1 - alpha) + val * alpha;
    out[i] = prev;
  }
  return out;
}

export function wilder(arr, period) {
  const n = arr.length;
  const out = new Array(n).fill(NaN);
  if (n < period) return out;
  const seed = nanmean(arr.slice(0, period));
  if (!Number.isFinite(seed)) return out;
  out[period - 1] = seed;
  const alpha = 1 / period;
  let prev = seed;
  for (let i = period; i < n; i++) {
    const val = arr[i];
    if (!Number.isFinite(val)) {
      out[i] = prev;
      continue;
    }
    prev = prev * (1 - alpha) + val * alpha;
    out[i] = prev;
  }
  return out;
}

export function rsiWilder(close, period = 14) {
  const n = close.length;
  const gain = new Array(n).fill(NaN);
  const loss = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    gain[i] = Math.max(d, 0);
    loss[i] = Math.max(-d, 0);
  }
  const avgG = wilder(gain, period);
  const avgL = wilder(loss, period);
  const rsi = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const g = avgG[i], l = avgL[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) continue;
    if (l === 0 && g > 0) rsi[i] = 100;
    else if (g === 0 && l > 0) rsi[i] = 0;
    else if (g === 0 && l === 0) rsi[i] = 50;
    else rsi[i] = 100 - (100 / (1 + g / l));
  }
  return rsi;
}

function emaOnValid(arr, span) {
  const vals = [];
  const idx = [];
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) {
      vals.push(arr[i]);
      idx.push(i);
    }
  }
  const e = ema(vals, span);
  const out = new Array(arr.length).fill(NaN);
  for (let i = 0; i < idx.length; i++) out[idx[i]] = e[i];
  return out;
}

export function computeIndicators(bars) {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const volume = bars.map((b) => b.volume);
  const ema5 = ema(close, 5);
  const ema10 = ema(close, 10);
  const sma50 = sma(close, 50);
  const sma200 = sma(close, 200);
  const rsi = rsiWilder(close, 14);
  const ema12 = ema(close, 12);
  const ema26 = ema(close, 26);
  const macd = close.map((_, i) =>
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : NaN
  );
  const signal = emaOnValid(macd, 9);
  const hist = macd.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN
  );
  const rawFi = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    if (Number.isFinite(close[i]) && Number.isFinite(close[i - 1])) {
      rawFi[i] = (close[i] - close[i - 1]) * (volume[i] || 0);
    }
  }
  const force = emaOnValid(rawFi, 13);
  return bars.map((b, i) => ({
    ...b,
    ema5: ema5[i],
    ema10: ema10[i],
    sma50: sma50[i],
    sma200: sma200[i],
    rsi: rsi[i],
    macd: macd[i],
    macdSignal: signal[i],
    macdHist: hist[i],
    force: force[i],
  }));
}

export function displayWindow(bars, months = 8) {
  if (!bars.length) return bars;
  const last = parseISODate(bars[bars.length - 1].date);
  const start = new Date(last.getTime());
  start.setMonth(start.getMonth() - months);
  const startISO = toISODate(start);
  let view = bars.filter((b) => b.date >= startISO);
  if (view.length < 60) view = bars.slice(-180);
  return view;
}

/* ---------- dates / formatting ---------- */

export function dateInTimeZone(unixSec, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(unixSec * 1000));
}

function todayInTimeZone(tz) {
  return dateInTimeZone(Date.now() / 1000, tz || NY_TZ);
}

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDayMonYear(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}-${MONTHS_SHORT[m - 1]}-${y}`;
}

export function compactNumber(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return "n/a";
  const sign = x < 0 ? "-" : "";
  const axv = Math.abs(x);
  if (axv >= 1e9) return `${sign}${(axv / 1e9).toFixed(digits)}B`;
  if (axv >= 1e6) return `${sign}${(axv / 1e6).toFixed(digits)}M`;
  if (axv >= 1e4) return `${sign}${(axv / 1e3).toFixed(digits)}K`;
  if (axv >= 100) return `${sign}${axv.toFixed(0)}`;
  if (axv >= 10) return `${sign}${axv.toFixed(1)}`;
  return `${sign}${axv.toFixed(2)}`;
}

function fmtPx(val) {
  if (!Number.isFinite(val)) return "n/a";
  return val.toFixed(2);
}

function fmtSigned(val, digits = 2) {
  if (!Number.isFinite(val)) return "n/a";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(digits)}`;
}

/* ---------- fetch layer ---------- */

function yahooChartUrl(symbol, host = "query1") {
  const sym = encodeURIComponent(symbol);
  return `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2y&includePrePost=false&_ts=${Date.now()}`;
}

const PROXIES = [
  {
    name: "corsproxy.io",
    wrap: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  },
  {
    name: "allorigins",
    wrap: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
];

async function fetchText(url, timeoutMs = 18000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function parseYahooChart(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Yahoo response was not JSON");
  }
  const err = data?.chart?.error;
  if (err) throw new Error(err.description || err.code || "Yahoo chart error");
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo chart empty");
  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const meta = result.meta || {};
  const tz = meta.exchangeTimezoneName || NY_TZ;
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    bars.push({
      date: dateInTimeZone(ts[i], tz),
      ts: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(volumes[i]) ? volumes[i] : 0,
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts));
  const dedup = [];
  for (const b of bars) {
    if (dedup.length && dedup[dedup.length - 1].date === b.date) {
      dedup[dedup.length - 1] = b;
    } else {
      dedup.push(b);
    }
  }
  if (dedup.length < 30) throw new Error(`Yahoo returned only ${dedup.length} bars`);
  return { bars: dedup, meta, tz };
}

export function applyLiveLastBar(series, meta, tz) {
  if (!meta || !Number.isFinite(meta.regularMarketPrice) || !meta.regularMarketTime) {
    return { bars: series, patched: false };
  }
  const quoteDay = dateInTimeZone(meta.regularMarketTime, tz);
  const today = todayInTimeZone(tz === "UTC" ? "UTC" : NY_TZ);
  const price = meta.regularMarketPrice;
  const dayHigh = Number.isFinite(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : price;
  const dayLow = Number.isFinite(meta.regularMarketDayLow) ? meta.regularMarketDayLow : price;
  const dayVol = Number.isFinite(meta.regularMarketVolume) ? meta.regularMarketVolume : 0;
  const dayOpen = Number.isFinite(meta.regularMarketOpen) ? meta.regularMarketOpen : null;
  const last = series[series.length - 1];
  const bars = series.slice();

  if (last.date === quoteDay) {
    const updated = {
      ...last,
      open: dayOpen != null ? dayOpen : last.open,
      high: Math.max(last.high, dayHigh, price),
      low: Math.min(last.low, dayLow, price),
      close: price,
      volume: dayVol || last.volume,
    };
    const changed =
      updated.close !== last.close ||
      updated.high !== last.high ||
      updated.low !== last.low ||
      updated.volume !== last.volume;
    if (changed) {
      bars[bars.length - 1] = updated;
      return { bars, patched: true };
    }
    return { bars, patched: false };
  }

  // Only invent a new session bar when the quote is from today and newer
  // than the last daily bar (Yahoo omitted the developing session).
  const quoteIsToday = quoteDay === today || (tz === "UTC" && quoteDay === todayInTimeZone("UTC"));
  if (quoteDay > last.date && quoteIsToday) {
    bars.push({
      date: quoteDay,
      ts: meta.regularMarketTime,
      open: dayOpen != null ? dayOpen : last.close,
      high: Math.max(dayHigh, price, dayOpen != null ? dayOpen : last.close),
      low: Math.min(dayLow, price, dayOpen != null ? dayOpen : last.close),
      close: price,
      volume: dayVol,
    });
    return { bars, patched: true };
  }
  return { bars, patched: false };
}

function stooqCandidates(symbol) {
  const s = String(symbol).toLowerCase();
  if (s === "btc-usd" || s === "btcusd") return ["btcusd"];
  if (s.endsWith(".to")) return [s];
  if (s.endsWith(".v") || s.endsWith(".ne")) return [s, s.replace(/\.(v|ne)$/, ".to")];
  if (s.includes(".")) return [s];
  return [`${s}.us`, s];
}

export function parseStooqCsv(text) {
  if (!text || text[0] === "<") throw new Error("Stooq returned HTML, not CSV");
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 5) throw new Error("Stooq CSV too short");
  const header = lines[0].toLowerCase().split(",");
  const idx = {
    date: header.findIndex((h) => h.trim() === "date"),
    open: header.findIndex((h) => h.trim() === "open"),
    high: header.findIndex((h) => h.trim() === "high"),
    low: header.findIndex((h) => h.trim() === "low"),
    close: header.findIndex((h) => h.trim() === "close"),
    volume: header.findIndex((h) => h.trim() === "volume"),
  };
  if (idx.date < 0 || idx.close < 0) throw new Error("Stooq CSV missing columns");
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const date = (parts[idx.date] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const open = parseFloat(parts[idx.open]);
    const high = parseFloat(parts[idx.high]);
    const low = parseFloat(parts[idx.low]);
    const close = parseFloat(parts[idx.close]);
    const volume = parseFloat(parts[idx.volume]);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    bars.push({
      date,
      ts: Date.parse(date + "T16:00:00Z") / 1000,
      open, high, low, close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (bars.length < 30) throw new Error(`Stooq returned only ${bars.length} bars`);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cutISO = toISODate(cutoff);
  const twoYear = bars.filter((b) => b.date >= cutISO);
  return twoYear.length >= 30 ? twoYear : bars;
}

async function fetchYahooAttempt(url, label) {
  const text = await fetchText(url);
  const parsed = parseYahooChart(text);
  const live = applyLiveLastBar(parsed.bars, parsed.meta, parsed.tz);
  return {
    bars: live.bars,
    meta: parsed.meta,
    tz: parsed.tz,
    source: label,
    patched: live.patched,
    name: parsed.meta.shortName || parsed.meta.longName || "",
  };
}

async function fetchStooqAttempt(symbol, wrap, wrapName) {
  const errors = [];
  for (const s of stooqCandidates(symbol)) {
    const raw = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
    const url = wrap ? wrap(raw) : raw;
    try {
      const text = await fetchText(url, 20000);
      const bars = parseStooqCsv(text);
      return {
        bars,
        meta: {},
        tz: NY_TZ,
        source: wrapName ? `stooq/${wrapName}` : "stooq",
        patched: false,
        name: "",
      };
    } catch (err) {
      errors.push(`${s}: ${err.message || err}`);
    }
  }
  throw new Error(errors.join("; ") || "Stooq failed");
}

export async function fetchDaily(symbol) {
  const attempts = [];
  const directHosts = ["query1", "query2"];
  for (const host of directHosts) {
    const label = `yahoo-${host}`;
    try {
      const out = await fetchYahooAttempt(yahooChartUrl(symbol, host), label);
      console.log(`[watchlist] ${symbol} source=${out.source} bars=${out.bars.length} last=${out.bars[out.bars.length - 1].date} close=${out.bars[out.bars.length - 1].close}`);
      return out;
    } catch (err) {
      attempts.push(`${label}: ${err.message || err}`);
      console.warn(`[watchlist] ${symbol} ${label} failed:`, err.message || err);
    }
  }
  for (const proxy of PROXIES) {
    try {
      const url = proxy.wrap(yahooChartUrl(symbol, "query1"));
      const out = await fetchYahooAttempt(url, `yahoo/${proxy.name}`);
      console.log(`[watchlist] ${symbol} source=${out.source} bars=${out.bars.length} last=${out.bars[out.bars.length - 1].date} close=${out.bars[out.bars.length - 1].close}`);
      return out;
    } catch (err) {
      attempts.push(`${proxy.name}: ${err.message || err}`);
      console.warn(`[watchlist] ${symbol} ${proxy.name} failed:`, err.message || err);
    }
  }
  try {
    const out = await fetchStooqAttempt(symbol, null, null);
    console.log(`[watchlist] ${symbol} source=${out.source} bars=${out.bars.length} last=${out.bars[out.bars.length - 1].date} close=${out.bars[out.bars.length - 1].close}`);
    return out;
  } catch (err) {
    attempts.push(`stooq: ${err.message || err}`);
    console.warn(`[watchlist] ${symbol} stooq failed:`, err.message || err);
  }
  for (const proxy of PROXIES) {
    try {
      const out = await fetchStooqAttempt(symbol, proxy.wrap, proxy.name);
      console.log(`[watchlist] ${symbol} source=${out.source} bars=${out.bars.length} last=${out.bars[out.bars.length - 1].date} close=${out.bars[out.bars.length - 1].close}`);
      return out;
    } catch (err) {
      attempts.push(`stooq/${proxy.name}: ${err.message || err}`);
    }
  }
  throw new Error(attempts.join(" | "));
}

export async function fetchItem(item) {
  const seen = new Set();
  const symbols = [];
  for (const s of [item.symbol, ...(item.symbol_candidates || [])]) {
    if (s && !seen.has(s)) {
      seen.add(s);
      symbols.push(s);
    }
  }
  let lastErr;
  for (const symbol of symbols) {
    try {
      const out = await fetchDaily(symbol);
      return { ...out, symbol };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("no symbol");
}

/* ---------- chart renderer ---------- */

function priceTicks(ymin, ymax) {
  const span = ymax - ymin;
  if (!(span > 0)) return [ymin, ymax];
  const rawStep = span / 7;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  let step = mag;
  for (const mult of [1, 2, 2.5, 5, 10]) {
    step = mag * mult;
    if (span / step <= 8) break;
  }
  const start = Math.floor(ymin / step) * step;
  const ticks = [];
  for (let t = start; t <= ymax + step * 0.5; t += step) {
    if (t >= ymin * 0.999 && t <= ymax * 1.001) ticks.push(t);
  }
  return ticks.length ? ticks : [ymin, ymax];
}

function monthTicks(dates) {
  const ticks = [];
  let prev = null;
  for (let i = 0; i < dates.length; i++) {
    const [y, m] = dates[i].split("-").map(Number);
    const key = `${y}-${m}`;
    if (key === prev) continue;
    const first = !prev;
    const label = first || m === 1 ? `${MONTHS_SHORT[m - 1]} ${y}` : MONTHS_SHORT[m - 1];
    ticks.push({ i, label });
    prev = key;
  }
  return ticks;
}

function niceFiTicks(absMax) {
  if (!(absMax > 0)) return [-1, 0, 1];
  return linearTicks(-absMax * 1.2, absMax * 1.2, 5);
}

function linearTicks(ymin, ymax, n = 5) {
  const span = ymax - ymin;
  if (!(span > 0)) return [ymin, ymax];
  const raw = span / Math.max(n - 1, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = mag;
  for (const mult of [1, 2, 2.5, 5, 10]) {
    step = mag * mult;
    if (span / step <= n) break;
  }
  const start = Math.ceil(ymin / step) * step;
  const ticks = [];
  for (let t = start; t <= ymax + step * 0.01; t += step) {
    const v = Math.abs(t) < step * 1e-9 ? 0 : t;
    ticks.push(v);
  }
  return ticks.length ? ticks : [ymin, 0, ymax];
}

function drawValueTag(ctx, x, y, text, facecolor, textcolor = "#fff") {
  ctx.save();
  ctx.font = "bold 9px Arial, Helvetica, sans-serif";
  const padX = 3.5, padY = 2.2;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 12;
  const top = y - h / 2;
  ctx.fillStyle = facecolor;
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = textcolor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + 0.5);
  ctx.restore();
}

function drawLine(ctx, xs, ys, yOf, color, width) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    const v = ys[i];
    if (!Number.isFinite(v)) {
      started = false;
      continue;
    }
    const y = yOf(v);
    if (!started) {
      ctx.moveTo(xs[i], y);
      started = true;
    } else {
      ctx.lineTo(xs[i], y);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function panelLabel(ctx, x, y, text) {
  ctx.save();
  ctx.font = "10px Arial, Helvetica, sans-serif";
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillRect(x - 2, y - 10, w, 14);
  ctx.fillStyle = COLORS.TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function renderChart(canvas, model) {
  const { ticker, name, view, fetchedAt } = model;
  const n = view.length;
  if (n < 10) throw new Error("Not enough bars to plot");

  const last = view[n - 1];
  const prevClose = n > 1 ? view[n - 2].close : last.close;
  const chg = last.close - prevClose;
  const chgPct = prevClose ? (chg / prevClose) * 100 : 0;

  const wrap = canvas.parentElement;
  const cssW = Math.max(280, (wrap && wrap.clientWidth) || 740);
  const cssH = Math.round(cssW * (10.15 / 16.2));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssW, cssH);

  const left = Math.round(cssW * 0.028);
  const right = Math.round(cssW * 0.905);
  const top0 = Math.round(cssH * 0.072);
  const bot0 = Math.round(cssH * 0.948);
  const plotH = bot0 - top0;
  const gap = Math.max(3, Math.round(plotH * 0.012));
  const units = 1.12 + 4.35 + 1.22 + 1.12;
  const usable = plotH - 3 * gap;
  const hRsi = usable * (1.12 / units);
  const hPx = usable * (4.35 / units);
  const hMacd = usable * (1.22 / units);
  const hFi = usable * (1.12 / units);

  const panels = {
    rsi: { top: top0, h: hRsi },
    px: { top: top0 + hRsi + gap, h: hPx },
    macd: { top: top0 + hRsi + gap + hPx + gap, h: hMacd },
    fi: { top: top0 + hRsi + gap + hPx + gap + hMacd + gap, h: hFi },
  };

  const xMin = -0.7;
  const xMax = n - 0.3;
  const plotW = right - left;
  const xOf = (i) => left + ((i - xMin) / (xMax - xMin)) * plotW;
  const xs = view.map((_, i) => xOf(i));
  const dates = view.map((b) => b.date);
  const months = monthTicks(dates);

  function yLin(panel, v, ymin, ymax) {
    return panel.top + panel.h * (1 - (v - ymin) / (ymax - ymin));
  }
  function yLog(panel, v, ymin, ymax) {
    const ly = Math.log(v);
    const lmin = Math.log(ymin);
    const lmax = Math.log(ymax);
    return panel.top + panel.h * (1 - (ly - lmin) / (lmax - lmin));
  }

  function strokeFrame(panel) {
    ctx.strokeStyle = COLORS.SPINE;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(left + 0.5, panel.top + 0.5, plotW - 1, panel.h - 1);
  }

  function clipPanel(panel) {
    ctx.beginPath();
    ctx.rect(left, panel.top, plotW, panel.h);
    ctx.clip();
  }

  // month grid for all panels
  for (const p of Object.values(panels)) {
    ctx.save();
    for (const m of months) {
      const x = xOf(m.i);
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + p.h);
      ctx.strokeStyle = COLORS.MONTH_GRID;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ----- RSI -----
  {
    const p = panels.rsi;
    const yOf = (v) => yLin(p, v, 0, 100);
    ctx.save();
    clipPanel(p);
    const y50 = yOf(50), y70 = yOf(70);
    ctx.fillStyle = COLORS.RSI_BAND;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(left, y70, plotW, y50 - y70);
    ctx.globalAlpha = 1;
    for (const lv of [30, 50, 70]) {
      ctx.beginPath();
      ctx.moveTo(left, yOf(lv));
      ctx.lineTo(right, yOf(lv));
      ctx.strokeStyle = lv === 50 ? "#90A4AE" : COLORS.RSI_REF;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    drawLine(ctx, xs, view.map((b) => b.rsi), yOf, COLORS.RSI_LINE, 1.05);
    ctx.restore();
    strokeFrame(p);
    ctx.fillStyle = COLORS.MUTED;
    ctx.font = "8.5px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const lv of [30, 50, 70]) {
      ctx.fillText(String(lv), right + 5, yOf(lv));
    }
    const rsiLbl = Number.isFinite(last.rsi)
      ? `RSI (14)    ${last.rsi.toFixed(2)}`
      : "RSI (14)";
    panelLabel(ctx, left + 4, p.top + 11, rsiLbl);
    if (Number.isFinite(last.rsi)) {
      drawValueTag(ctx, right + 1, yOf(last.rsi), last.rsi.toFixed(1), "#212121");
    }
  }

  // ----- Price + volume -----
  {
    const p = panels.px;
    const lo = Math.min(...view.map((b) => b.low));
    const hi = Math.max(...view.map((b) => b.high));
    const pad = lo > 0 ? (hi / lo) ** 0.02 : 0.02;
    let ymin = lo / (1 + Math.max(pad - 1, 0.012));
    let ymax = hi * 1.018;
    if (ymin <= 0) ymin = lo * 0.98;
    const yOf = (v) => yLog(p, v, ymin, ymax);

    // volume
    const vmax = Math.max(...view.map((b) => b.volume), 1);
    ctx.save();
    clipPanel(p);
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = COLORS.VOLUME;
    const volH = p.h / 4.8;
    const barW = Math.max(0.8, (xOf(1) - xOf(0)) * 0.78);
    for (let i = 0; i < n; i++) {
      const vh = (view[i].volume / vmax) * volH;
      ctx.fillRect(xs[i] - barW / 2, p.top + p.h - vh, barW, vh);
    }
    ctx.globalAlpha = 1;

    // OHLC
    const tick = Math.max(1.2, (xOf(1) - xOf(0)) * 0.36);
    ctx.lineWidth = 1.15;
    ctx.lineCap = "butt";
    for (let i = 0; i < n; i++) {
      const b = view[i];
      const prev = i === 0 ? b.open : view[i - 1].close;
      ctx.strokeStyle = b.close >= prev ? COLORS.UP_BAR : COLORS.DOWN_BAR;
      ctx.beginPath();
      ctx.moveTo(xs[i], yOf(b.low));
      ctx.lineTo(xs[i], yOf(b.high));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xs[i] - tick, yOf(b.open));
      ctx.lineTo(xs[i], yOf(b.open));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xs[i], yOf(b.close));
      ctx.lineTo(xs[i] + tick, yOf(b.close));
      ctx.stroke();
    }

    drawLine(ctx, xs, view.map((b) => b.ema5), yOf, COLORS.EMA5, 0.95);
    drawLine(ctx, xs, view.map((b) => b.ema10), yOf, COLORS.EMA10, 0.95);
    drawLine(ctx, xs, view.map((b) => b.sma50), yOf, COLORS.SMA50, 1.5);
    drawLine(ctx, xs, view.map((b) => b.sma200), yOf, COLORS.SMA200, 1.9);
    ctx.restore();

    // y grid + labels
    const ticks = priceTicks(ymin, ymax);
    ctx.save();
    ctx.font = "8.5px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const t of ticks) {
      if (t <= 0) continue;
      const y = yOf(t);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.strokeStyle = COLORS.GRID;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = COLORS.MUTED;
      ctx.fillText(t >= 10 ? t.toFixed(0) : t.toFixed(2), right + 5, y);
    }
    ctx.restore();
    strokeFrame(p);

    const overlays = [
      [`EMA(5)   ${fmtPx(last.ema5)}`, COLORS.EMA5],
      [`EMA(10)  ${fmtPx(last.ema10)}`, COLORS.EMA10],
      [`SMA(50)  ${fmtPx(last.sma50)}`, COLORS.SMA50],
      [`SMA(200) ${fmtPx(last.sma200)}`, COLORS.SMA200],
    ];
    ctx.save();
    ctx.font = "9px Arial, Helvetica, sans-serif";
    overlays.forEach(([text, color], i) => {
      const y = p.top + 11 + i * 13;
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillRect(left + 2, y - 8, w, 13);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, left + 5, y);
    });
    ctx.restore();
    drawValueTag(ctx, right + 1, yOf(last.close), last.close.toFixed(2), "#111111");
  }

  // ----- MACD -----
  {
    const p = panels.macd;
    const vals = [];
    for (const b of view) {
      if (Number.isFinite(b.macd)) vals.push(b.macd);
      if (Number.isFinite(b.macdSignal)) vals.push(b.macdSignal);
      if (Number.isFinite(b.macdHist)) vals.push(b.macdHist);
    }
    const mabs = vals.length ? Math.max(...vals.map(Math.abs)) : 1;
    const ymin = -mabs * 1.25, ymax = mabs * 1.25;
    const yOf = (v) => yLin(p, v, ymin, ymax);
    ctx.save();
    clipPanel(p);
    ctx.beginPath();
    ctx.moveTo(left, yOf(0));
    ctx.lineTo(right, yOf(0));
    ctx.strokeStyle = COLORS.ZERO;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const barW = Math.max(0.8, (xOf(1) - xOf(0)) * 0.72);
    for (let i = 0; i < n; i++) {
      const h = view[i].macdHist;
      if (!Number.isFinite(h)) continue;
      ctx.fillStyle = h >= 0 ? COLORS.MACD_HIST_POS : COLORS.MACD_HIST_NEG;
      const y0 = yOf(0);
      const y1 = yOf(h);
      const top = Math.min(y0, y1);
      const ht = Math.max(0.6, Math.abs(y1 - y0));
      ctx.globalAlpha = 0.9;
      ctx.fillRect(xs[i] - barW / 2, top, barW, ht);
      ctx.globalAlpha = 1;
    }
    drawLine(ctx, xs, view.map((b) => b.macd), yOf, COLORS.MACD_LINE, 1.05);
    drawLine(ctx, xs, view.map((b) => b.macdSignal), yOf, COLORS.MACD_SIGNAL, 1.05);
    ctx.restore();
    strokeFrame(p);
    ctx.fillStyle = COLORS.MUTED;
    ctx.font = "8.5px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const t of linearTicks(ymin, ymax, 5)) {
      const y = yOf(t);
      if (y < p.top + 6 || y > p.top + p.h - 6) continue;
      ctx.fillText(t.toFixed(2), right + 5, y);
    }
    let macdLbl = "MACD (12, 26, 9)";
    if (Number.isFinite(last.macd)) {
      macdLbl += `    ${last.macd.toFixed(3)}    Signal ${last.macdSignal.toFixed(3)}    Hist ${last.macdHist.toFixed(3)}`;
    }
    panelLabel(ctx, left + 4, p.top + 11, macdLbl);
    if (Number.isFinite(last.macd)) {
      drawValueTag(ctx, right + 1, yOf(last.macd), last.macd.toFixed(2), COLORS.MACD_LINE);
    }
  }

  // ----- Force Index -----
  {
    const p = panels.fi;
    const fin = view.map((b) => b.force).filter(Number.isFinite);
    const fiAbs = fin.length ? Math.max(...fin.map(Math.abs)) : 1;
    const ymin = -fiAbs * 1.2, ymax = fiAbs * 1.2;
    const yOf = (v) => yLin(p, v, ymin, ymax);
    ctx.save();
    clipPanel(p);
    ctx.beginPath();
    ctx.moveTo(left, yOf(0));
    ctx.lineTo(right, yOf(0));
    ctx.strokeStyle = COLORS.ZERO;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const y0 = yOf(0);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = view[i].force;
      if (!Number.isFinite(v) || v < 0) {
        if (started) {
          ctx.lineTo(xs[i], y0);
          ctx.closePath();
          ctx.fillStyle = COLORS.FI_POS;
          ctx.globalAlpha = 0.75;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          started = false;
        }
        continue;
      }
      if (!started) {
        ctx.moveTo(xs[i], y0);
        ctx.lineTo(xs[i], yOf(v));
        started = true;
      } else {
        ctx.lineTo(xs[i], yOf(v));
      }
    }
    if (started) {
      ctx.lineTo(xs[n - 1], y0);
      ctx.closePath();
      ctx.fillStyle = COLORS.FI_POS;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    started = false;
    for (let i = 0; i < n; i++) {
      const v = view[i].force;
      if (!Number.isFinite(v) || v >= 0) {
        if (started) {
          ctx.lineTo(xs[i], y0);
          ctx.closePath();
          ctx.fillStyle = COLORS.FI_NEG;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          started = false;
        }
        continue;
      }
      if (!started) {
        ctx.moveTo(xs[i], y0);
        ctx.lineTo(xs[i], yOf(v));
        started = true;
      } else {
        ctx.lineTo(xs[i], yOf(v));
      }
    }
    if (started) {
      ctx.lineTo(xs[n - 1], y0);
      ctx.closePath();
      ctx.fillStyle = COLORS.FI_NEG;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawLine(ctx, xs, view.map((b) => b.force), yOf, COLORS.FI_LINE, 0.8);
    ctx.restore();
    strokeFrame(p);
    ctx.fillStyle = COLORS.MUTED;
    ctx.font = "8.5px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const t of niceFiTicks(fiAbs)) {
      ctx.fillText(compactNumber(t), right + 5, yOf(t));
    }
    let fiLbl = "Force Index (13)";
    if (Number.isFinite(last.force)) fiLbl += `    ${compactNumber(last.force, 2)}`;
    panelLabel(ctx, left + 4, p.top + 11, fiLbl);
    if (Number.isFinite(last.force)) {
      const tagColor = last.force >= 0 ? "#2E7D32" : "#C62828";
      drawValueTag(ctx, right + 1, yOf(last.force), compactNumber(last.force, 2), tagColor);
    }

    // x labels
    ctx.fillStyle = COLORS.MUTED;
    ctx.font = "9px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const m of months) {
      ctx.fillText(m.label, xOf(m.i), p.top + p.h + 4);
    }
  }

  // header
  ctx.fillStyle = COLORS.TEXT;
  ctx.font = "bold 13px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const title = `${ticker} (${name}) Daily`;
  ctx.fillText(title, left, 8);

  const lastDt = formatDayMonYear(last.date);
  const chgSign = chg >= 0 ? "+" : "";
  const headerRight =
    `${lastDt}   O ${last.open.toFixed(2)}   H ${last.high.toFixed(2)}   ` +
    `L ${last.low.toFixed(2)}   C ${last.close.toFixed(2)}   ` +
    `Vol ${compactNumber(last.volume, 2)}   ` +
    `Chg ${chgSign}${chg.toFixed(2)} (${chgSign}${chgPct.toFixed(2)}%)`;
  ctx.fillStyle = COLORS.MUTED;
  ctx.font = "9.5px Arial, Helvetica, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(headerRight, right, 11);
  void fetchedAt;
}

/* ---------- page ---------- */

async function poolMap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPage(watchlist) {
  const nav = document.getElementById("nav");
  const main = document.getElementById("main");
  nav.innerHTML = "";
  main.innerHTML = "";
  for (const cat of watchlist.categories) {
    const a = document.createElement("a");
    a.href = `#${cat.id}`;
    a.textContent = cat.title;
    nav.appendChild(a);

    const sec = document.createElement("section");
    sec.id = cat.id;
    const h2 = document.createElement("h2");
    h2.textContent = cat.title;
    sec.appendChild(h2);
    for (const item of cat.items) {
      const fig = document.createElement("figure");
      fig.id = item.ticker;
      fig.dataset.ticker = item.ticker;
      fig.innerHTML =
        `<figcaption>${escapeHtml(item.ticker)} — ${escapeHtml(item.name)} ` +
        `<span class="meta">loading…</span></figcaption>` +
        `<div class="chart-wrap">` +
        `<p class="status">Fetching live daily bars…</p>` +
        `<canvas hidden></canvas>` +
        `</div>`;
      sec.appendChild(fig);
    }
    main.appendChild(sec);
  }
}

async function renderOne(item) {
  const fig = document.getElementById(item.ticker);
  const metaEl = fig.querySelector(".meta");
  const status = fig.querySelector(".status");
  const canvas = fig.querySelector("canvas");
  const fetchedAt = new Date();
  try {
    const data = await fetchItem(item);
    const full = computeIndicators(data.bars);
    const view = displayWindow(full, 8);
    canvas.hidden = false;
    renderChart(canvas, {
      ticker: item.ticker,
      name: item.name,
      view,
      fetchedAt,
    });
    status.remove();
    const last = view[view.length - 1];
    const todayNY = todayInTimeZone(NY_TZ);
    const todayEx = todayInTimeZone(data.tz || NY_TZ);
    const liveNow = data.patched && (last.date === todayNY || last.date === todayEx);
    metaEl.textContent =
      `${last.date} · ${last.close.toFixed(2)} · ${data.source}` +
      (liveNow ? " · live last bar" : "");
    fig.dataset.ok = "1";
    fig.dataset.source = data.source;
    fig.dataset.last = last.date;
    fig.dataset.close = String(last.close);
    fig.dataset.symbol = data.symbol;
    return {
      ticker: item.ticker,
      ok: true,
      last: last.date,
      close: last.close,
      source: data.source,
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[watchlist] ${item.ticker} failed:`, err);
    status.className = "fail-msg";
    status.textContent = `Could not load ${item.ticker} (${item.symbol}): ${msg}`;
    metaEl.textContent = "failed";
    fig.dataset.ok = "0";
    fig.dataset.error = msg;
    return { ticker: item.ticker, ok: false, error: msg };
  }
}

function updateAsOf(results, fetchedAt) {
  const el = document.getElementById("asof");
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const dates = ok
    .filter((r) => r.ticker !== "BTCUSD")
    .map((r) => r.last);
  const pool = dates.length ? dates : ok.map((r) => r.last);
  let common = "";
  if (pool.length) {
    const counts = {};
    for (const d of pool) counts[d] = (counts[d] || 0) + 1;
    common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const t = fetchedAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateBit = common ? formatDayMonYear(common) : "n/a";
  let text = `As of ${dateBit} · fetched ${t}`;
  if (failed.length) text += ` · ${failed.length} failed`;
  el.textContent = text;
}

export async function main() {
  const asof = document.getElementById("asof");
  let watchlist;
  try {
    const res = await fetch(`watchlist.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`watchlist.json HTTP ${res.status}`);
    watchlist = await res.json();
  } catch (err) {
    asof.textContent = `Failed to load watchlist.json: ${err.message || err}`;
    return;
  }
  if (watchlist.title) document.querySelector("h1").textContent = watchlist.title;
  document.title = watchlist.title || "Watchlist";
  buildPage(watchlist);
  const items = [];
  for (const cat of watchlist.categories) {
    for (const item of cat.items) items.push(item);
  }
  const fetchedAt = new Date();
  const results = await poolMap(items, 5, renderOne);
  updateAsOf(results, fetchedAt);
  const ok = results.filter((r) => r.ok).length;
  document.body.dataset.done = "1";
  document.body.dataset.ok = String(ok);
  document.body.dataset.total = String(results.length);
  console.log(`[watchlist] done ${ok}/${results.length} charts`);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { main(); });
  } else {
    main();
  }
}
