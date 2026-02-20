import { Resvg } from "@resvg/resvg-js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ChartData } from "./data";
import { buildChart } from "./chart";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");

export async function render(d: ChartData): Promise<Buffer> {
  return Buffer.from(new Resvg(await buildChart(d), {
    font: { fontDirs: [fontsDir], defaultFontFamily: "Inter" },
  }).render().asPng());
}
