import type { ChartData } from "./data";

const num = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (t: Date, tz?: string) => t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz && { timeZone: tz }) });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function fetchB64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return `data:${r.headers.get("content-type") || "image/png"};base64,${b.toString("base64")}`;
  } catch { return null; }
}

function svgPath(bars: ChartData["bars"], w: number, h: number) {
  const c = bars.map(b => b.close).filter(p => p > 0);
  if (!c.length) return { line: "", area: "", yMin: 0, yMax: 0 };
  const min = Math.min(...c), max = Math.max(...c), pad = (max - min || 1) * 0.1;
  const yMin = min - pad, yMax = max + pad, r = yMax - yMin;
  const pts = bars.map((b, i) => `${(i / (bars.length - 1 || 1)) * w},${h - ((b.close - yMin) / r) * h}`);
  return { line: `M ${pts.join(" L ")}`, area: `M ${pts.join(" L ")} L ${w},${h} L 0,${h} Z`, yMin, yMax };
}

async function fetchExIcon(d: ChartData): Promise<string | null> {
  const ex = d.symbol.split(":")[0], prov = d.symbolInfo.providerId?.toLowerCase();
  const urls = [ex && `https://s3-symbol-logo.tradingview.com/source/${ex}.svg`, prov && `https://s3-symbol-logo.tradingview.com/provider/${prov}.svg`].filter(Boolean) as string[];
  for (const u of urls) {
    const b = await fetchB64(u);
    if (b) return b;
  }
  return null;
}

export async function buildChart(d: ChartData): Promise<string> {
  const W = 1920, H = 1080, PX = 60, PY = 40, cW = 1660, cH = 680, cY = 300;
  const up = d.change >= 0, col = up ? "#22ab94" : "#f7525f";
  const { line, area, yMin, yMax } = svgPath(d.bars, cW, cH), r = yMax - yMin;

  const logoUrl = d.symbolInfo.logoid && `https://s3-symbol-logo.tradingview.com/${d.symbolInfo.logoid}--600.png`;
  const [logo, exIcon] = await Promise.all([logoUrl ? fetchB64(logoUrl) : null, fetchExIcon(d)]);

  const pD = d.currentPrice < 10 ? 5 : d.currentPrice < 100 ? 3 : 2;
  const sgn = up ? "+" : "", cD = Math.abs(d.change) < 1 ? 5 : Math.abs(d.change) < 10 ? 3 : 2;

  const yT = [...Array(6)].map((_, i) => { const p = yMin + (r * i) / 5; return { p, d: p < 10 ? 4 : p < 100 ? 2 : p < 1000 ? 1 : 0 }; }).reverse();

  const xT = (() => {
    if (!d.bars.length) return [];
    const stock = d.symbolInfo.type === "stock" || d.sessionInfo?.marketPhase === "regular" || d.sessionInfo?.marketPhase === "extended";
    const tz = stock ? "America/New_York" : undefined;
    if (stock && d.sessionInfo?.marketPhase === "regular") {
      const t: string[] = [], s = new Date(d.bars[0].time);
      s.setHours(9, 30, 0, 0);
      for (let ms = s.getTime(); ms <= d.bars.at(-1)!.time; ms += 1.8e6) t.push(fmt(new Date(ms), "America/New_York"));
      return t;
    }
    const start = d.bars[0].time, end = d.bars.at(-1)!.time;
    const step = ((end - start) / 3.6e6 > 12 ? 2 : 1) * 3.6e6;
    const t: string[] = [];
    for (let ms = Math.ceil(start / step) * step; ms <= end; ms += step) t.push(fmt(new Date(ms), tz));
    return t;
  })();

  const lastY = r > 0 && d.bars.at(-1) ? ((yMax - d.bars.at(-1)!.close) / r) * cH : cH / 2;
  const plY = r > 0 ? ((yMax - d.currentPrice) / r) * cH : cH / 2;

  const exIconX = PX + 100, exY = PY + 82;
  const symX = exIcon ? exIconX + 28 : exIconX;
  const exSvg = exIcon ? `<image href="${exIcon}" x="${exIconX}" y="${exY - 17}" width="20" height="20" preserveAspectRatio="xMidYMid meet"/>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, sans-serif">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.3"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></linearGradient>
<filter id="gl"><feGaussianBlur stdDeviation="7.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${logo ? `<clipPath id="lc"><circle cx="${PX + 40}" cy="${PY + 40}" r="40"/></clipPath>` : ""}
</defs>
<rect width="${W}" height="${H}" fill="#000"/>
${logo
    ? `<image href="${logo}" x="${PX}" y="${PY}" width="80" height="80" clip-path="url(#lc)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${PX + 40}" cy="${PY + 40}" r="40" fill="${col}"/><text x="${PX + 40}" y="${PY + 55}" text-anchor="middle" fill="#fff" font-size="40" font-weight="700">$</text>`}
<text x="${PX + 100}" y="${PY + 45}" fill="#fff" font-size="36" font-weight="600">${esc(d.symbolInfo.description || d.symbolInfo.name)}</text>
${exSvg}<text x="${symX}" y="${exY}" fill="#888" font-size="20">${esc(d.symbol)}</text>
<text x="${PX}" y="${PY + 170}" fill="#fff" font-size="80" font-weight="700">${num(d.currentPrice, pD)}<tspan font-size="28" fill="#888" dx="10">${d.symbolInfo.currency || "USD"}</tspan></text>
<text x="${PX}" y="${PY + 215}" font-size="26"><tspan fill="${col}" font-weight="600">${sgn}${num(d.change, cD)}</tspan><tspan fill="${col}" font-weight="600" dx="12">${sgn}${num(d.changePercent, 2)}%</tspan><tspan fill="#666" dx="12">${d.sessionInfo?.label || "24 hours"}</tspan></text>
<g transform="translate(${PX},${cY})">
<path d="${area}" fill="url(#g)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="0" y1="${plY}" x2="${cW}" y2="${plY}" stroke="#fff" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="10 10"/>
<circle cx="${cW}" cy="${lastY}" r="10" fill="${col}" filter="url(#gl)"/>
</g>
${yT.map((t, i) => `<text x="${PX + cW + 20}" y="${cY + i * cH / 5 + 7}" fill="#666" font-size="22">${num(t.p, t.d)}</text>`).join("\n")}
${xT.length > 1 ? xT.map((t, i) => `<text x="${PX + i * cW / (xT.length - 1)}" y="${cY + cH + 35}" fill="#666" font-size="22" text-anchor="middle">${t}</text>`).join("\n") : ""}
<g transform="translate(${PX + 10},${cY + cH - 70})" opacity="0.4">
<path fill="#888" d="M14 6H2v6h6v9h6V6Zm12 15h-7l6-15h7l-6 15Zm-7-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" transform="scale(2)"/>
<text x="80" y="20" fill="#888" font-size="18">Data as of</text><text x="80" y="42" fill="#888" font-size="18">${fmt(new Date())} ET</text>
</g>
</svg>`;
}
