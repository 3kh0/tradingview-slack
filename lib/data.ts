import WebSocket from "ws";

// trading view runs on websockets, which makes our job much easier.
// go to https://www.tradingview.com/symbols/EURUSD/ and open devtools to see the messages being sent/received.
// there is alot of crap, so just filter to only websocket frames and look for ones with "~m~" in them.

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface SymbolInfo { symbol: string; name: string; description: string; exchange: string; type: string; currency: string; logoid?: string; providerId?: string }
export interface ChartData { symbol: string; symbolInfo: SymbolInfo; bars: Bar[]; currentPrice: number; change: number; changePercent: number }

const genId = (p: string) => p + [...Array(12)].map(() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.random() * 36 | 0]).join("");
const fmt = (m: string, p: any[]) => { const s = JSON.stringify({ m, p }); return `~m~${s.length}~m~${s}`; };

function parse(d: string): any[] {
  const r: any[] = [], re = /~m~(\d+)~m~/g;
  let m;
  while ((m = re.exec(d))) {
    const c = d.substring(re.lastIndex, re.lastIndex + +m[1]);
    re.lastIndex += +m[1];
    if (c[0] === "{") try { r.push(JSON.parse(c)); } catch {}
  }
  return r;
}

export function pull(sym: string, interval = "5", count = 288): Promise<ChartData> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket", { headers: { Origin: "https://www.tradingview.com" } });
    const cs = genId("cs_"), qs = genId("qs_");
    let info: SymbolInfo | null = null, bars: Bar[] = [], price = 0, chg = 0, chgPct = 0, done = false;

    const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 15000);

    ws.on("open", () => {
      ws.send(fmt("set_auth_token", ["bullshit"])); // if valid, this would give us nyse/nasdaq data instead of cboe, but i dont got that type of money
      ws.send(fmt("chart_create_session", [cs, ""]));
      ws.send(fmt("quote_create_session", [qs]));
      ws.send(fmt("quote_set_fields", [qs, "ch", "chp", "current_session", "description", "local_description", "exchange", "format", "fractional", "is_tradable", "language", "logoid", "logo", "lp", "lp_time", "minmov", "minmove2", "original_name", "pricescale", "pro_name", "short_name", "type", "update_mode", "volume", "currency_code", "rchp", "rtc"]));
      ws.send(fmt("quote_add_symbols", [qs, sym]));
      ws.send(fmt("resolve_symbol", [cs, "sds_sym_1", `={"symbol":"${sym}","adjustment":"splits","session":"extended"}`]));
      ws.send(fmt("create_series", [cs, "sds_1", "s1", "sds_sym_1", interval, count, ""]));
    });

    ws.on("message", (d: Buffer) => {
      for (const msg of parse(d.toString())) {
        if (!msg.m) continue;
        if (msg.m === "qsd" && msg.p?.[1]?.v) {
          const v = msg.p[1].v;
          if (v.lp) price = v.lp;
          if (v.ch) chg = v.ch;
          if (v.chp) chgPct = v.chp;
          if (!info && v.short_name) {
            info = {
              symbol: sym, name: v.short_name || v.description || sym.split(":")[1],
              description: v.description || "", exchange: v.exchange || sym.split(":")[0],
              type: v.type || "index", currency: v.currency_code || "USD",
              logoid: v.logoid || v.logo?.logoid, providerId: v.provider_id,
            };
          }
        }
        if (msg.m === "timescale_update" && msg.p?.[1]?.sds_1?.s) {
          for (const b of msg.p[1].sds_1.s) if (b.v?.length >= 5) bars.push({ time: b.v[0] * 1000, open: b.v[1], high: b.v[2], low: b.v[3], close: b.v[4], volume: b.v[5] || 0 });
          done = true;
        }
        if (msg.m === "series_completed" && done) {
          clearTimeout(t); ws.close();
          bars.sort((a, b) => a.time - b.time);
          if (chg === 0 && bars.length > 1) { chg = bars.at(-1)!.close - bars[0].close; chgPct = (chg / bars[0].close) * 100; }
          resolve({
            symbol: sym,
            symbolInfo: info || { symbol: sym, name: sym.split(":")[1], description: sym, exchange: sym.split(":")[0], type: "unknown", currency: "USD" },
            bars, currentPrice: price || bars.at(-1)?.close || 0, change: chg, changePercent: chgPct,
          });
        }
      }
    });

    ws.on("error", e => { clearTimeout(t); reject(e); });
    ws.on("close", () => { clearTimeout(t); if (!done) reject(new Error("con closed")); });
  });
}
