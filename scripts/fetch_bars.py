#!/usr/bin/env python3
"""Fetch ~2y of daily OHLCV from Yahoo and write same-origin JSON snapshots."""
from __future__ import annotations

import json
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

NY_TZ = "America/New_York"
UA = "Mozilla/5.0"
SLEEP_S = 0.15
MIN_BARS = 30
HOSTS = ("query1", "query2")

REPO_ROOT = Path(__file__).resolve().parent.parent
WATCHLIST_PATH = REPO_ROOT / "watchlist.json"
DATA_DIR = REPO_ROOT / "data"


def is_finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def date_in_timezone(unix_sec: float, tz: str) -> str:
    name = tz or NY_TZ
    try:
        tzinfo = ZoneInfo(name)
    except Exception:
        tzinfo = ZoneInfo(NY_TZ)
    return datetime.fromtimestamp(unix_sec, tzinfo).strftime("%Y-%m-%d")


def today_in_timezone(tz: str) -> str:
    return date_in_timezone(time.time(), tz)


def parse_yahoo_chart(payload: dict) -> tuple[list[dict], dict, str]:
    err = (payload.get("chart") or {}).get("error")
    if err:
        raise ValueError(err.get("description") or err.get("code") or "Yahoo chart error")
    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        raise ValueError("Yahoo chart empty")
    result = results[0]
    ts = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0] or {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    meta = result.get("meta") or {}
    tz = meta.get("exchangeTimezoneName") or NY_TZ
    bars = []
    n = len(ts)
    for i in range(n):
        o = opens[i] if i < len(opens) else None
        h = highs[i] if i < len(highs) else None
        l = lows[i] if i < len(lows) else None
        c = closes[i] if i < len(closes) else None
        if not all(is_finite(v) for v in (o, h, l, c)):
            continue
        vol = volumes[i] if i < len(volumes) else None
        bars.append({
            "date": date_in_timezone(ts[i], tz),
            "ts": int(ts[i]),
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "volume": float(vol) if is_finite(vol) else 0.0,
        })
    bars.sort(key=lambda b: (b["date"], b["ts"]))
    dedup: list[dict] = []
    for b in bars:
        if dedup and dedup[-1]["date"] == b["date"]:
            dedup[-1] = b
        else:
            dedup.append(b)
    if len(dedup) < MIN_BARS:
        raise ValueError(f"Yahoo returned only {len(dedup)} bars")
    return dedup, meta, tz


def apply_live_last_bar(series: list[dict], meta: dict, tz: str) -> tuple[list[dict], bool]:
    if not meta:
        return series, False
    price = meta.get("regularMarketPrice")
    rtime = meta.get("regularMarketTime")
    if not is_finite(price) or not is_finite(rtime):
        return series, False
    quote_day = date_in_timezone(rtime, tz)
    today = today_in_timezone("UTC" if tz == "UTC" else NY_TZ)
    day_high = meta.get("regularMarketDayHigh") if is_finite(meta.get("regularMarketDayHigh")) else price
    day_low = meta.get("regularMarketDayLow") if is_finite(meta.get("regularMarketDayLow")) else price
    day_vol = meta.get("regularMarketVolume") if is_finite(meta.get("regularMarketVolume")) else 0
    day_open = meta.get("regularMarketOpen") if is_finite(meta.get("regularMarketOpen")) else None
    last = series[-1]
    bars = list(series)

    if last["date"] == quote_day:
        updated = dict(last)
        updated["open"] = float(day_open) if day_open is not None else last["open"]
        updated["high"] = max(last["high"], float(day_high), float(price))
        updated["low"] = min(last["low"], float(day_low), float(price))
        updated["close"] = float(price)
        updated["volume"] = float(day_vol) if day_vol else last["volume"]
        changed = (
            updated["close"] != last["close"]
            or updated["high"] != last["high"]
            or updated["low"] != last["low"]
            or updated["volume"] != last["volume"]
        )
        if changed:
            bars[-1] = updated
            return bars, True
        return bars, False

    quote_is_today = quote_day == today or (tz == "UTC" and quote_day == today_in_timezone("UTC"))
    if quote_day > last["date"] and quote_is_today:
        open_px = float(day_open) if day_open is not None else last["close"]
        bars.append({
            "date": quote_day,
            "ts": int(rtime),
            "open": open_px,
            "high": max(float(day_high), float(price), open_px),
            "low": min(float(day_low), float(price), open_px),
            "close": float(price),
            "volume": float(day_vol) if is_finite(day_vol) else 0.0,
        })
        return bars, True
    return bars, False


def yahoo_url(symbol: str, host: str) -> str:
    encoded = urllib.parse.quote(symbol, safe="-.")
    return (
        f"https://{host}.finance.yahoo.com/v8/finance/chart/{encoded}"
        f"?interval=1d&range=2y&includePrePost=false"
    )


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
            if resp.status != 200:
                raise ValueError(f"HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        raise ValueError(f"HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise ValueError(f"fetch failed: {e.reason}") from e
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError("Yahoo response was not UTF-8") from e


def fetch_symbol(symbol: str) -> dict:
    errors = []
    for host in HOSTS:
        url = yahoo_url(symbol, host)
        try:
            text = http_get(url)
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as e:
                raise ValueError("Yahoo response was not JSON") from e
            bars, meta, tz = parse_yahoo_chart(payload)
            bars, patched = apply_live_last_bar(bars, meta, tz)
            name = meta.get("shortName") or meta.get("longName") or ""
            return {
                "symbol": symbol,
                "name": name,
                "tz": tz,
                "source": f"yahoo-{host}",
                "patched": patched,
                "bars": bars,
            }
        except Exception as e:
            errors.append(f"{host}: {e}")
    raise ValueError(" | ".join(errors) or "Yahoo failed")


def item_symbols(item: dict) -> list[str]:
    seen = set()
    out = []
    for s in [item.get("symbol"), *(item.get("symbol_candidates") or [])]:
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def load_items(path: Path) -> list[dict]:
    watchlist = json.loads(path.read_text(encoding="utf-8"))
    items = []
    for cat in watchlist.get("categories") or []:
        for item in cat.get("items") or []:
            items.append(item)
    return items


def write_snapshot(item: dict, fetched: dict) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ticker = item["ticker"]
    payload = {
        "ticker": ticker,
        "symbol": fetched["symbol"],
        "name": fetched["name"] or item.get("name") or "",
        "tz": fetched["tz"],
        "source": fetched["source"],
        "patched": bool(fetched["patched"]),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bars": fetched["bars"],
    }
    out = DATA_DIR / f"{ticker}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def main() -> int:
    if not WATCHLIST_PATH.is_file():
        print(f"FAIL missing {WATCHLIST_PATH}", file=sys.stderr)
        return 1
    items = load_items(WATCHLIST_PATH)
    if not items:
        print("FAIL watchlist has no items", file=sys.stderr)
        return 1

    failed = []
    for i, item in enumerate(items):
        ticker = item.get("ticker") or "?"
        symbols = item_symbols(item)
        last_err = "no symbol"
        ok = False
        for symbol in symbols:
            try:
                fetched = fetch_symbol(symbol)
                path = write_snapshot(item, fetched)
                last = fetched["bars"][-1]
                print(
                    f"OK {ticker} symbol={fetched['symbol']} bars={len(fetched['bars'])} "
                    f"last={last['date']} close={last['close']} patched={fetched['patched']} "
                    f"source={fetched['source']} -> {path.name}"
                )
                ok = True
                break
            except Exception as e:
                last_err = str(e)
        if not ok:
            print(f"FAIL {ticker}: {last_err}")
            failed.append((ticker, last_err))
        if i + 1 < len(items):
            time.sleep(SLEEP_S)

    if failed:
        print(f"\n{len(failed)} ticker(s) failed:", file=sys.stderr)
        for ticker, err in failed:
            print(f"  {ticker}: {err}", file=sys.stderr)
        return 1
    print(f"\nAll {len(items)} tickers wrote snapshots to {DATA_DIR}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
