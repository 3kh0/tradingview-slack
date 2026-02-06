import type { ChartData } from "./data";

const num = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (t: Date, tz?: string) => t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz && { timeZone: tz }) });

function svgPath(data: ChartData, w: number, h: number) {
  const c = data.bars.map(b => b.close).filter(p => p > 0);
  if (!c.length) return { line: "", area: "", yMin: 0, yMax: 0 };
  const min = Math.min(...c), max = Math.max(...c), pad = (max - min || 1) * 0.1;
  const yMin = min - pad, yMax = max + pad, r = yMax - yMin;
  const pts = data.bars.map((b, i) => `${(i / (data.bars.length - 1 || 1)) * w},${h - ((b.close - yMin) / r) * h}`);
  return { line: `M ${pts.join(" L ")}`, area: `M ${pts.join(" L ")} L ${w},${h} L 0,${h} Z`, yMin, yMax };
}

export function buildChart(d: ChartData): string {
  const W = 1920, H = 1080, cW = 1680, cH = 680;
  const up = d.change >= 0, col = up ? "#22ab94" : "#f7525f", fill = up ? "rgba(34,171,148,0.3)" : "rgba(247,82,95,0.3)";
  const { line, area, yMin, yMax } = svgPath(d, cW, cH), r = yMax - yMin;

  const logo = d.symbolInfo.logoid ? `https://s3-symbol-logo.tradingview.com/${d.symbolInfo.logoid}--600.png` : null;
  const ex = d.symbol.split(":")[0], prov = d.symbolInfo.providerId?.toLowerCase();
  const exUrls = [ex && `https://s3-symbol-logo.tradingview.com/source/${ex}.svg`, prov && `https://s3-symbol-logo.tradingview.com/provider/${prov}.svg`].filter(Boolean);

  const pDec = d.currentPrice < 10 ? 5 : d.currentPrice < 100 ? 3 : 2;
  const sign = up ? "+" : "", cDec = Math.abs(d.change) < 1 ? 5 : Math.abs(d.change) < 10 ? 3 : 2;
  const yTicks = [...Array(6)].map((_, i) => { const p = yMin + (r * i) / 5; return { p, d: p < 10 ? 4 : p < 100 ? 2 : p < 1000 ? 1 : 0 }; }).reverse();

  const isStock = d.symbolInfo.type === "stock" || d.sessionInfo?.marketPhase === "regular" || d.sessionInfo?.marketPhase === "extended";
  const xTicks = isStock && d.bars.length > 0
    ? (() => {
        const s = new Date(d.bars[0].time); s.setHours(9, 30, 0, 0);
        const span = new Date(d.bars.at(-1)!.time).getTime() - s.getTime();
        return [...Array(7)].map((_, i) => { const t = new Date(s.getTime() + (span * i) / 6); t.setMinutes(Math.round(t.getMinutes() / 30) * 30); return fmt(t, "America/New_York"); });
      })()
    : [...Array(7)].map((_, i) => { const b = d.bars[Math.floor((i / 6) * (d.bars.length - 1))]; return b ? fmt(new Date(b.time)) : ""; });

  const lastY = d.bars.at(-1) ? ((yMax - d.bars.at(-1)!.close) / r) * 100 : 50;
  const priceY = ((yMax - d.currentPrice) / r) * 100;
  const sess = d.sessionInfo?.label || "24 hours";

  return `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}html{font-size:20px}
body{width:${W}px;height:${H}px;background:#000;font-family:-apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;color:#fff;overflow:hidden}
.c{display:flex;flex-direction:column;height:100%;padding:2rem 3rem}
.h{margin-bottom:1.5rem}.sr{display:flex;align-items:center;gap:1rem;margin-bottom:.5rem}
.l{width:4rem;height:4rem;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;flex-shrink:0;overflow:hidden}
.l img{width:100%;height:100%;object-fit:cover}.si{display:flex;flex-direction:column}
.sn{font-size:1.8rem;font-weight:600;line-height:1.2}.sc{font-size:1rem;color:#888;display:flex;align-items:center;gap:.4rem}
.ei{width:1rem;height:1rem;border-radius:2px;object-fit:contain}.ps{margin-top:.5rem}
.cp{display:flex;align-items:baseline;gap:.5rem}.pv{font-size:4rem;font-weight:700;line-height:1;font-feature-settings:"tnum" on,"lnum" on}
.pc{font-size:1.4rem;color:#888}.ci{display:flex;align-items:center;gap:.6rem;margin-top:.3rem;font-size:1.3rem;font-feature-settings:"tnum" on,"lnum" on}
.cv,.cpct{color:${col};font-weight:600}.cper{color:#666;white-space:nowrap}
.cc{flex:1;display:flex;position:relative;margin-top:1rem}.ca{flex:1;position:relative}
.cs{width:100%;height:100%}.ya{width:7rem;display:flex;flex-direction:column;justify-content:space-between;padding:0 1rem}
.yt{font-size:1.1rem;color:#666;text-align:right}.xa{display:flex;justify-content:space-between;padding:.75rem 0;margin-right:7rem}
.xt{font-size:1.1rem;color:#666}
.pl{position:absolute;left:0;right:0;height:2px;background:repeating-linear-gradient(to right,rgba(255,255,255,.3) 0,rgba(255,255,255,.3) 10px,transparent 10px,transparent 20px);top:${priceY}%}
.ed{position:absolute;right:0;width:1rem;height:1rem;background:${col};border-radius:50%;transform:translate(50%,-50%);top:${lastY}%;box-shadow:0 0 .75rem ${col}}
.tv{position:absolute;bottom:.5rem;left:.5rem;opacity:.4;display:flex;align-items:center;gap:.5rem;font-size:.9rem;color:#888}
</style></head><body><div class="c"><div class="h"><div class="sr"><div class="l">${logo ? `<img src="${logo}" onerror="this.parentElement.innerHTML='$'"/>` : "$"}</div><div class="si"><div class="sn">${d.symbolInfo.description || d.symbolInfo.name}</div><div class="sc">${exUrls.length ? `<img class="ei" src="${exUrls[0]}" data-fallbacks='${JSON.stringify(exUrls.slice(1))}' onerror="var f=JSON.parse(this.dataset.fallbacks||'[]');if(f.length){this.dataset.fallbacks=JSON.stringify(f.slice(1));this.src=f[0]}else{this.style.display='none'}"/>` : ""}${d.symbol}</div></div></div><div class="ps"><div class="cp"><span class="pv">${num(d.currentPrice, pDec)}</span><span class="pc">${d.symbolInfo.currency || "USD"}</span></div><div class="ci"><span class="cv">${sign}${num(d.change, cDec)}</span><span class="cpct">${sign}${num(d.changePercent, 2)}%</span><span class="cper"> ${sess}</span></div></div></div><div class="cc"><div class="ca"><svg class="cs" viewBox="0 0 ${cW} ${cH}" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${fill}"/><stop offset="100%" stop-color="rgba(0,0,0,0)"/></linearGradient></defs><path d="${area}" fill="url(#g)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="pl"></div><div class="ed"></div><div class="tv"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 28" width="70" height="56"><path fill="#888" d="M14 6H2v6h6v9h6V6Zm12 15h-7l6-15h7l-6 15Zm-7-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg><p>Data last updated at<br>${new Date().toLocaleString()} ET</p></div></div><div class="ya">${yTicks.map(t => `<div class="yt">${num(t.p, t.d)}</div>`).join("")}</div></div><div class="xa">${xTicks.map(t => `<div class="xt">${t}</div>`).join("")}</div></div></body></html>`;
}
