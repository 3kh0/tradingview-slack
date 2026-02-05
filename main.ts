import { writeFile, mkdir } from "fs/promises";
import { pull, render, close } from "./lib";

const OUT = "./charts";
const symbols = [
  { tv: "COINBASE:BTCUSD", name: "BTCUSD" },
  { tv: "TVC:USOIL", name: "OIL" },
  { tv: "FX:EURUSD", name: "EURUSD" },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const { tv, name } of symbols) {
    console.log(`\n📊 ${name} (${tv})`);
    try {
      const d = await pull(tv, "5", 288);
      console.log(`   ${d.symbolInfo.description || d.symbolInfo.name}`);
      console.log(`   p: ${d.currentPrice} | c: ${d.change.toFixed(3)} (${d.changePercent.toFixed(2)}%)`);
      console.log(`   b: ${d.bars.length} | l: ${d.symbolInfo.logoid || "none"}`);
      await writeFile(`${OUT}/${name}.png`, await render(d));
    } catch (e: any) { console.error(`fail ${e.message}`); }
  }
  await close();
}

main().catch(console.error);
