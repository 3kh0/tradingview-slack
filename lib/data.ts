import WebSocket from "ws";

// trading view runs on websockets, which makes our job much easier.
// go to https://www.tradingview.com/symbols/EURUSD/ and open devtools to see the messages being sent/received.
// there is alot of crap, so just filter to only websocket frames and look for ones with "~m~" in them.

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface SymbolInfo { symbol: string; name: string; description: string; exchange: string; type: string; currency: string; logoid?: string; providerId?: string; timezone?: string }
export interface SessionInfo {
  session: string;
  hours: number;
  label: string;
  type: string;
  currentSession?: string; // "market", "pre_market", "post_market", "closed"
  marketPhase?: "regular" | "extended" | "crypto";
  timezone?: string;
  symbolType?: string;
}
export interface ChartData { symbol: string; symbolInfo: SymbolInfo; bars: Bar[]; currentPrice: number; change: number; changePercent: number; sessionInfo?: SessionInfo }

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

interface SessionWindow {
  startHour: number;
  endHour: number;
  wraps: boolean;
  durationHours: number;
}

function parseWindowPair(startHHMM: string, endHHMM: string): SessionWindow {
  const start = Number(startHHMM);
  const end = Number(endHHMM);

  const startHour = Math.floor(start / 100) + (start % 100) / 60;
  const endHour = Math.floor(end / 100) + (end % 100) / 60;

  let durationHours = endHour - startHour;
  const wraps = durationHours <= 0;
  if (wraps) durationHours += 24;

  return { startHour, endHour, wraps, durationHours };
}

function parseWindows(sessionStr: string): SessionWindow[] {
  const windows: SessionWindow[] = [];
  const regex = /(\d{4})-(\d{4})/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sessionStr)) !== null) {
    windows.push(parseWindowPair(match[1], match[2]));
  }

  return windows;
}

function parseWindow(sessionStr: string): SessionWindow | null {
  const windows = parseWindows(sessionStr);
  if (!windows.length) return null;
  return windows[0];
}

function hourInSessionWindow(hour: number, w: SessionWindow): boolean {
  if (!w.wraps) return hour >= w.startHour && hour <= w.endHour;
  return hour >= w.startHour || hour <= w.endHour;
}

// tv session string ("24x7", "0400-2000", "1800-1700")
export function session(sessionStr: string): SessionInfo {
  if (!sessionStr) return { session: "", hours: 24, label: "24 hours", type: "unknown" };

  if (sessionStr === "24x7") {
    return { session: sessionStr, hours: 24, label: "24 hours", type: "crypto" };
  }

  const windows = parseWindows(sessionStr);
  if (!windows.length) return { session: sessionStr, hours: 24, label: "24 hours", type: "unknown" };

  const hours = windows.reduce((sum, w) => sum + w.durationHours, 0);

  let type: string;
  let label: string;

  if (hours >= 23) {
    type = "24h_market";
    label = "past day";
  } else if (hours >= 12) {
    type = "extended";
    label = "extended session";
  } else if (hours >= 6) {
    type = "regular";
    label = "today";
  } else {
    type = "short";
    label = `${hours.toFixed(1)}h session`;
  }

  return { session: sessionStr, hours, label, type };
}

export function barCount(sessionStr: string, intervalMinutes: number): number {
  const s = session(sessionStr);
  const interval = Math.max(1, intervalMinutes || 1);
  return Math.max(10, Math.ceil(s.hours * 60 / interval * 1.1));
}

function barCountFromHours(hours: number, intervalMinutes: number): number {
  const interval = Math.max(1, intervalMinutes || 1);
  return Math.max(10, Math.ceil(hours * 60 / interval * 1.1));
}

export function getHourInTimezone(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const hour = Number(parts.find(p => p.type === "hour")?.value || 0);
  const minute = Number(parts.find(p => p.type === "minute")?.value || 0);
  return hour + minute / 60;
}

export function getETHour(timestamp: number): number {
  return getHourInTimezone(timestamp, "America/New_York");
}

function determineMarketPhase(sessionStr: string, currentSession: string, symbolType: string): { hours: number; label: string; marketPhase: "regular" | "extended" | "crypto" } {
  if (sessionStr === "24x7" || symbolType === "spot" || symbolType === "crypto") {
    return { hours: 24, label: "24 hours", marketPhase: "crypto" };
  }

  const range = parseWindow(sessionStr);
  if (!range) {
    return { hours: 6.5, label: "trading session", marketPhase: "regular" };
  }

  const totalHours = range.durationHours;
  const equityLike = symbolType === "stock" || symbolType === "index" || symbolType === "fund";

  if (totalHours >= 23 && !equityLike) {
    return { hours: totalHours, label: "past day", marketPhase: "extended" };
  }

  switch (currentSession) {
    case "market":
      return {
        hours: equityLike ? 6.5 : totalHours,
        label: equityLike ? "today" : session(sessionStr).label,
        marketPhase: equityLike ? "regular" : totalHours >= 12 ? "extended" : "regular",
      };

    case "post_market":
      return {
        hours: Math.max(totalHours, 10.5), 
        label: "post market",
        marketPhase: "extended"
      };

    case "pre_market":
      return {
        hours: Math.max(totalHours, 6.5),
        label: "pre market",
        marketPhase: "extended",
      };

    default:
      return {
        hours: equityLike ? 6.5 : totalHours,
        label: equityLike ? "today" : session(sessionStr).label,
        marketPhase: equityLike ? "regular" : totalHours >= 12 ? "extended" : "regular",
      };
  }
}

export function getSession(sym: string, timeoutMs = 8000): Promise<SessionInfo> {
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket", { headers: { Origin: "https://www.tradingview.com" } });
    const cs = genId("cs_"), qs = genId("qs_");
    let sessionData: Partial<SessionInfo> & { timezone?: string; currentSession?: string; symbolType?: string } = {};
    let timeout: NodeJS.Timeout;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();

      if (sessionData.session) {
        const base = session(sessionData.session);
        const phase = determineMarketPhase(
          sessionData.session,
          sessionData.currentSession || "",
          sessionData.symbolType || base.type
        );

        resolve({
          session: sessionData.session,
          hours: phase.hours,
          label: phase.label,
          type: base.type,
          currentSession: sessionData.currentSession,
          marketPhase: phase.marketPhase,
          timezone: sessionData.timezone,
          symbolType: sessionData.symbolType,
        });
        return;
      }

      resolve({
        session: "",
        hours: 24,
        label: "24 hours",
        type: "unknown",
        currentSession: sessionData.currentSession,
        marketPhase: sessionData.symbolType === "spot" || sessionData.symbolType === "crypto" ? "crypto" : "extended",
        timezone: sessionData.timezone,
        symbolType: sessionData.symbolType,
      });
    };

    timeout = setTimeout(done, timeoutMs);

    ws.on("open", () => {
      ws.send(fmt("set_auth_token", ["unauthorized_user_token"]));
      ws.send(fmt("chart_create_session", [cs, ""]));
      ws.send(fmt("quote_create_session", [qs]));
      ws.send(fmt("quote_set_fields", [qs, "session", "type", "timezone", "current_session"]));
      ws.send(fmt("quote_add_symbols", [qs, sym]));
      ws.send(fmt("resolve_symbol", [cs, "sds_sym_1", `={"symbol":"${sym}","adjustment":"splits","session":"extended"}`]));
    });

    ws.on("message", (d: Buffer) => {
      for (const msg of parse(d.toString())) {
        if (msg.m === "symbol_resolved" && msg.p?.[2]) {
          const info = msg.p[2];
          if (info.session) sessionData.session = info.session;
          if (info.type) sessionData.symbolType = info.type;
          if (info.timezone) sessionData.timezone = info.timezone;
        }
        if (msg.m === "qsd" && msg.p?.[1]?.v) {
          const v = msg.p[1].v;
          if (v.session && !sessionData.session) sessionData.session = v.session;
          if (v.type && !sessionData.symbolType) sessionData.symbolType = v.type;
          if (v.timezone && !sessionData.timezone) sessionData.timezone = v.timezone;
          if (v.current_session && !sessionData.currentSession) sessionData.currentSession = v.current_session;

          if (sessionData.session && sessionData.currentSession) { done(); return; }
        }
      }
    });

    ws.on("error", done);
    ws.on("close", done);
  });
}

export async function pull(sym: string, interval = "5", count?: number): Promise<ChartData> {
  let sessionInfo: SessionInfo | undefined;
  let effectiveCount = count;
  const intervalMinutes = parseInt(interval) || 5;

  if (effectiveCount === undefined || effectiveCount === null) {
    sessionInfo = await getSession(sym);
    effectiveCount = sessionInfo.session
      ? barCount(sessionInfo.session, intervalMinutes)
      : barCountFromHours(sessionInfo.hours || 24, intervalMinutes);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket", { headers: { Origin: "https://www.tradingview.com" } });
    const cs = genId("cs_"), qs = genId("qs_");
    let info: SymbolInfo | null = null, bars: Bar[] = [], price = 0, chg = 0, chgPct = 0, done = false;
    let resolvedSession: string | undefined;
    let resolvedTimezone: string | undefined;
    let resolvedRegularSession: string | undefined;

    const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 15000);

    ws.on("open", () => {
      ws.send(fmt("set_auth_token", ["unauthorized_user_token"]));
      ws.send(fmt("chart_create_session", [cs, ""]));
      ws.send(fmt("quote_create_session", [qs]));
      ws.send(fmt("quote_set_fields", [qs, "ch", "chp", "current_session", "description", "local_description", "exchange", "format", "fractional", "is_tradable", "language", "logoid", "logo", "lp", "lp_time", "minmov", "minmove2", "original_name", "pricescale", "pro_name", "provider_id", "short_name", "timezone", "type", "update_mode", "volume", "currency_code", "rchp", "rtc"]));
      ws.send(fmt("quote_add_symbols", [qs, sym]));
      ws.send(fmt("resolve_symbol", [cs, "sds_sym_1", `={"symbol":"${sym}","adjustment":"splits","session":"extended"}`]));
      ws.send(fmt("create_series", [cs, "sds_1", "s1", "sds_sym_1", interval, effectiveCount, ""]));
    });

    let currentSessionFromData: string | undefined;

    ws.on("message", (d: Buffer) => {
      for (const msg of parse(d.toString())) {
        if (!msg.m) continue;

        if (msg.m === "symbol_resolved" && msg.p?.[2]) {
          const resolved = msg.p[2];
          if (resolved.session) resolvedSession = resolved.session;
          if (resolved.timezone) resolvedTimezone = resolved.timezone;

          if (Array.isArray(resolved.subsessions)) {
            const regular = resolved.subsessions.find((s: any) => s?.id === "regular" && typeof s?.session === "string");
            if (regular?.session) resolvedRegularSession = regular.session;
          }

          if (!info) {
            info = {
              symbol: sym,
              name: resolved.name || resolved.short_description || sym.split(":")[1],
              description: resolved.description || resolved.local_description || "",
              exchange: resolved.exchange || resolved.exchange_listed_name || sym.split(":")[0],
              type: resolved.type || "unknown",
              currency: resolved.currency_code || "USD",
              logoid: resolved.logoid,
              providerId: resolved.provider_id,
              timezone: resolved.timezone,
            };
          }
        }

        if (msg.m === "qsd" && msg.p?.[1]?.v) {
          const v = msg.p[1].v;
          if (v.lp) price = v.lp;
          if (v.ch) chg = v.ch;
          if (v.chp) chgPct = v.chp;
          if (v.session && !resolvedSession) resolvedSession = v.session;
          if (v.timezone && !resolvedTimezone) resolvedTimezone = v.timezone;
          if (v.current_session && !currentSessionFromData) currentSessionFromData = v.current_session;
          if (!info) {
            info = { symbol: sym, name: sym.split(":")[1], description: "", exchange: sym.split(":")[0], type: "unknown", currency: "USD" };
          }

          info.name = v.short_name || v.description || info.name;
          info.description = v.description || info.description;
          info.exchange = v.exchange || info.exchange;
          info.type = v.type || info.type;
          info.currency = v.currency_code || info.currency;
          info.logoid = v.logoid || v.logo?.logoid || info.logoid;
          info.providerId = v.provider_id || info.providerId;
          info.timezone = v.timezone || info.timezone || resolvedTimezone;
        }
        if (msg.m === "timescale_update" && msg.p?.[1]?.sds_1?.s) {
          for (const b of msg.p[1].sds_1.s) if (b.v?.length >= 5) bars.push({ time: b.v[0] * 1000, open: b.v[1], high: b.v[2], low: b.v[3], close: b.v[4], volume: b.v[5] || 0 });
          done = true;
        }
        if (msg.m === "series_completed" && done) {
          clearTimeout(t); ws.close();
          bars.sort((a, b) => a.time - b.time);

          const finalSession = resolvedSession || sessionInfo?.session || "";
          let finalSessionInfo = sessionInfo;

          if (!finalSessionInfo && resolvedSession) {
            const base = session(resolvedSession);
            const currentSess = currentSessionFromData || sessionInfo?.currentSession || "";
            const phase = determineMarketPhase(resolvedSession, currentSess, info?.type || base.type);
            finalSessionInfo = {
              session: resolvedSession,
              hours: phase.hours,
              label: phase.label,
              type: base.type,
              currentSession: currentSess,
              marketPhase: phase.marketPhase,
              timezone: resolvedTimezone,
              symbolType: info?.type,
            };
          }

          const isEquityLike = info?.type === "stock" || info?.type === "index" || info?.type === "fund";
          if (finalSessionInfo?.marketPhase === "regular" && isEquityLike && bars.length) {
            const marketTimezone = info?.timezone || finalSessionInfo.timezone || "America/New_York";
            const range = parseWindow(resolvedRegularSession || finalSession);
            const regularWindow = (range && range.durationHours <= 8)
              ? range
              : { startHour: 9.5, endHour: 16, wraps: false, durationHours: 6.5 };

            const lastBarDate = new Date(bars.at(-1)!.time).toLocaleDateString("en-US", { timeZone: marketTimezone });
            const filteredBars = bars.filter(bar => {
              const barDate = new Date(bar.time).toLocaleDateString("en-US", { timeZone: marketTimezone });
              if (barDate !== lastBarDate) return false;
              const marketHour = getHourInTimezone(bar.time, marketTimezone);
              return hourInSessionWindow(marketHour, regularWindow);
            });
            if (filteredBars.length >= 10) {
              bars = filteredBars;
            }
          }

          if (bars.length > 1) { chg = bars.at(-1)!.close - bars[0].open; chgPct = (chg / bars[0].open) * 100; }

          resolve({
            symbol: sym,
            symbolInfo: info || { symbol: sym, name: sym.split(":")[1], description: sym, exchange: sym.split(":")[0], type: "unknown", currency: "USD" },
            bars, currentPrice: price || bars.at(-1)?.close || 0, change: chg, changePercent: chgPct,
            sessionInfo: finalSessionInfo,
          });
        }
      }
    });

    ws.on("error", e => { clearTimeout(t); reject(e); });
    ws.on("close", () => { clearTimeout(t); if (!done) reject(new Error("con closed")); });
  });
}
