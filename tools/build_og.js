// Знімає шаблони прев'ю (Telegram, Viber, Facebook) у PNG 1200×630:
//   tools/og.html        → img/og.png         (головна; бере data.js + votes.js — запускати після build_votes.py)
//   tools/og-svitlo.html → img/og-svitlo.png  (сторінка «Світло»; статичне)
// Запуск:  node tools/build_og.js
const path = require("path");
const { chromium } = require("playwright");

const SHOTS = [["og.html", "og.png"], ["og-svitlo.html", "og-svitlo.png"]];

(async () => {
  const root = path.join(__dirname, "..");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [src, out] of SHOTS) {
    await page.goto("file://" + path.join(root, "tools", src));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, "img", out) });
    console.log(`img/${out} оновлено`);
  }
  await browser.close();
})();
