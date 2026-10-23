// Знімає tools/og.html у img/og.png (прев'ю для Telegram, Viber, Facebook).
// Запуск після build_votes.py:  node tools/build_og.js
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const root = path.join(__dirname, "..");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.join(root, "tools", "og.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "img", "og.png") });
  await browser.close();
  console.log("img/og.png оновлено");
})();
