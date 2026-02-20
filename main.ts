import { writeFile, mkdir } from "fs/promises";
import { pull, render } from "./lib";
import WebSocket from "ws";

const OUT = "./charts";
const symbols = [
  { tv: "COINBASE:BTCUSD", name: "BTCUSD" },
  { tv: "TVC:USOIL", name: "OIL" },
  { tv: "FX:EURUSD", name: "EURUSD" },
];

interface Result {
  symbols: Array<{
    symbol: string;
    exchange: string;
    description: string;
    prefix?: string;
  }>;
}

async function search(query: string): Promise<{ symbol: string; description: string }> {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(query)}&hl=0&lang=en&search_type=undefined&domain=production&sort_by_country=US`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0",
      "Origin": "https://www.tradingview.com",
      "Referer": "https://www.tradingview.com/",
    },
  });
  const data: Result = await res.json();
  if (!data.symbols?.length) throw new Error(`no symbol found for "${query}"`);
  const top = data.symbols[0];
  const prefix = top.prefix || top.exchange;
  return { symbol: `${prefix}:${top.symbol}`, description: top.description };
}

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

async function lookup(query: string) {
  const { symbol, description } = await search(query);
  const d = await pull(symbol, "1");
  await mkdir(OUT, { recursive: true });
  const name = symbol.replace(":", "_");
  await writeFile(`${OUT}/${name}.png`, await render(d));
  console.log(`saved to ${OUT}/${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const { tv, name } of symbols) {
    console.log(`\n📊 ${name} (${tv})`);
    try {
      const d = await pull(tv, "1");
      console.log(`   ${d.symbolInfo.description || d.symbolInfo.name}`);
      console.log(`   p: ${d.currentPrice} | c: ${d.change.toFixed(3)} (${d.changePercent.toFixed(2)}%)`);
      console.log(`   b: ${d.bars.length} | session: ${d.sessionInfo?.label || "24 hours"} | l: ${d.symbolInfo.logoid || "none"}`);
      await writeFile(`${OUT}/${name}.png`, await render(d));
    } catch (e: any) { console.error(`fail ${e.message}`); }
  }
}

const arg = process.argv[2];
if (arg) {
  lookup(arg).catch(console.error);
} else {
  main().catch(console.error);
}
