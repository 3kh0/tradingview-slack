import { chromium, Browser } from "playwright-core";
import type { ChartData } from "./data";
import { buildChart } from "./chart";

let browser: Browser | null = null;

export async function render(data: ChartData): Promise<Buffer> {
  browser ??= await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(buildChart(data), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const buf = await page.screenshot({ type: "png" });
  await page.close();
  return Buffer.from(buf);
}

export async function close() {
  if (browser) { await browser.close(); browser = null; }
}
