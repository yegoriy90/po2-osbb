// Сторінка «Поруч»: заклади ЖК з Google-таблиці «ПО2 · Комерція (публічна)» (CSV, data.js → poruchCsv),
// карта ЖК (контури секцій зі схеми забудови) і приміщення з альбому комерції забудовника (1-1…4-7).
(function () {
  const S = window.SITE || {};
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  document.querySelectorAll("[data-bind]").forEach((el) => (el.textContent = S[el.dataset.bind] || ""));
  document.querySelectorAll("[data-href]").forEach((el) => (el.href = S[el.dataset.href]));

  // ---------- Карта ----------
  // Координати — у системі схеми забудови (аркуш 01 альбому). «Вулиця» — 1-й поверх, вхід ззовні;
  // «Двір» — 2-й поверх, вихід на стилобат.
  const UNITS = {
    "1-3": [1, "Вулиця", 108, 690], "1-1": [1, "Вулиця", 140, 602], "1-2": [1, "Вулиця", 166, 522],
    "1-8": [1, "Двір", 206, 700], "1-7": [1, "Двір", 226, 652], "1-6": [1, "Двір", 243, 604], "1-5": [1, "Двір", 261, 556], "1-4": [1, "Двір", 296, 500],
    "2-4": [2, "Вулиця", 214, 330], "2-1": [2, "Вулиця", 220, 150], "2-2": [2, "Вулиця", 300, 62], "2-3": [2, "Вулиця", 400, 46],
    "2-9": [2, "Двір", 318, 412], "2-8": [2, "Двір", 346, 346], "2-7": [2, "Двір", 371, 280], "2-6": [2, "Двір", 396, 212], "2-5": [2, "Двір", 422, 142],
    "3-2": [3, "Вулиця", 525, 43], "3-1": [3, "Вулиця", 690, 43],
    "3-6": [3, "Двір", 515, 168], "3-5": [3, "Двір", 578, 168], "3-4": [3, "Двір", 640, 168], "3-3": [3, "Двір", 702, 168],
    "4-3": [4, "Вулиця", 885, 335], "4-2": [4, "Вулиця", 980, 425], "4-1": [4, "Вулиця", 952, 640],
    "4-7": [4, "Двір", 768, 345], "4-6": [4, "Двір", 781, 415], "4-5": [4, "Двір", 795, 488], "4-4": [4, "Двір", 810, 565],
  };
  const SHAPES = {
    s1: "102,731 97,712 181,478 245,473 283,477 271,515 225,640 210,681 181,707 117,731",
    s2: "237,93 259,78 343,77 435,47 443,65 335,361 312,384 282,396 241,423 231,366 234,183",
    s3: "530,62 735,58 740,135 712,150 560,152 532,136",
    s4: "781,288 803,299 864,327 963,383 971,447 900,464 914,528 941,661 920,678 862,646 833,610 773,296",
    yard: "300,440 335,361 443,65 528,92 540,152 735,150 770,296 830,610 800,690 250,692 225,640 271,515",
  };
  const BADGES = [[1, 176, 640], [2, 300, 150], [3, 610, 108], [4, 880, 560]];

  const CAT = { "Кава": "☕", "Їжа": "🍽", "Продукти": "🛒", "Краса": "💇", "Здоровʼя": "💊", "Здоров'я": "💊", "Діти": "🧸", "Спорт": "🏋️", "Послуги": "🛠", "Тварини": "🐾", "Інше": "📍" };
  const icon = (c) => CAT[c] || "📍";

  // ---------- Дані ----------
  const parseCsv = (text) => {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };
  const COLS = { show: /показ/i, name: /назва/i, cat: /категор/i, unit: /приміщ/i, sec: /секц/i, side: /^де$/i, about: /пропонує|опис/i, hours: /годин/i,
    phone: /телеф/i, ig: /insta/i, site: /сайт/i, photo: /фото/i, noPower: /без світла/i, deal: /^акція(?! діє)/i, dealTill: /діє до/i };
  const toPlaces = (rows) => {
    const head = rows[0] || [], idx = {};
    for (const [k, re] of Object.entries(COLS)) idx[k] = head.findIndex((h) => re.test(h.trim()));
    return rows.slice(1).map((r) => {
      const o = {}; for (const k in idx) o[k] = idx[k] >= 0 ? (r[idx[k]] || "").trim() : "";
      return o;
    }).filter((o) => o.name && /^(так|yes|1|true|✅)/i.test(o.show));
  };
  const DEMO = [
    { name: "Кав'ярня «Ранок» (приклад)", cat: "Кава", unit: "2-6", about: "Кава, випічка, сніданки", hours: "Пн-Пт 7:30-21:00; Сб-Нд 9:00-20:00", phone: "+380670000000", ig: "example", noPower: "так", deal: "−10% на каву до 10:00 для мешканців ПО2", dealTill: "31.12.2026" },
    { name: "Мінімаркет «Біля дому» (приклад)", cat: "Продукти", unit: "4-3", about: "Продукти, побутова хімія, гаряча випічка", hours: "щодня 7:00-23:00", phone: "+380670000001", noPower: "так" },
    { name: "Студія краси «Лаванда» (приклад)", cat: "Краса", unit: "1-6", about: "Стрижки, манікюр, брови", hours: "Вт-Нд 10:00-20:00; Пн вихідний", ig: "example", deal: "Перший візит −15%", dealTill: "31.01.2027" },
    { name: "Аптека (приклад)", cat: "Здоровʼя", unit: "3-1", about: "Ліки, вітаміни, засоби гігієни", hours: "цілодобово", phone: "+380670000002" },
    { name: "Дитячий клуб «Озерце» (приклад)", cat: "Діти", unit: "3-4", about: "Розвивальні заняття 2–7 років, англійська", hours: "Пн-Пт 9:00-19:00", ig: "example" },
  ];

  // ---------- Години роботи ----------
  const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];
  const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  // «Пн-Пт 8:00-21:00; Сб-Нд 9-20», «щодня 8:00-22:00», «цілодобово», «Пн вихідний» → [[ [from,to], … ] × 7], хвилини
  const parseHours = (s) => {
    const week = Array.from({ length: 7 }, () => []);
    if (!s) return null;
    let any = false;
    for (const part of s.toLowerCase().replace(/[’ʼ]/g, "'").split(/[;\n]+|,\s*(?=(?:пн|вт|ср|чт|пт|сб|нд|щодн))/)) {
      const days = new Set();
      if (/щодн|без вихідн|цілодоб|24\/7/.test(part)) for (let i = 0; i < 7; i++) days.add(i);
      for (const m of part.matchAll(/(пн|вт|ср|чт|пт|сб|нд)(?:\s*[-–—]\s*(пн|вт|ср|чт|пт|сб|нд))?/g)) {
        const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
        for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; }
      }
      if (!days.size) for (let i = 0; i < 7; i++) days.add(i);
      if (/вихідн|зачинено/.test(part) && !/без вихідн/.test(part)) { days.forEach((d) => (week[d] = [])); any = true; continue; }
      let range = null;
      if (/цілодоб|24\/7/.test(part)) range = [0, 1440];
      const t = part.match(/(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?/);
      if (t) range = [+t[1] * 60 + +(t[2] || 0), +t[3] * 60 + +(t[4] || 0)];
      if (!range) continue;
      if (range[1] <= range[0]) range[1] += 1440; // до півночі й далі
      days.forEach((d) => week[d].push(range)); any = true;
    }
    return any ? week : null;
  };
  const kyivNow = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { d: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday), m: +p.hour * 60 + +p.minute };
  };
  const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  // → { open: bool, text } або null, якщо годин немає
  const status = (week) => {
    if (!week) return null;
    const { d, m } = kyivNow();
    if (week[d].some(([a, b]) => a === 0 && b >= 1440)) return { open: true, text: "Відкрито цілодобово" };
    for (const [a, b] of week[d]) if (m >= a && m < b) return { open: true, text: `Відкрито до ${hm(b)}` };
    for (const [a, b] of week[(d + 6) % 7]) if (b > 1440 && m < b - 1440) return { open: true, text: `Відкрито до ${hm(b)}` };
    for (let k = 0; k < 7; k++) {
      const day = (d + k) % 7, next = week[day].map(([a]) => a).filter((a) => k > 0 || a > m).sort((x, y) => x - y)[0];
      if (next != null) return { open: false, text: `Відкриється ${k === 0 ? "сьогодні" : k === 1 ? "завтра" : "у " + DAY_NAMES[day]} о ${hm(next)}` };
    }
    return { open: false, text: "Зачинено" };
  };
  const parseDate = (s) => {
    let m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], 23, 59);
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59) : null;
  };

  // ---------- Рендер ----------
  let places = [], filter = "all", lightOff = false, demo = /[?&]demo/.test(location.search);
  // Плитка без фото: ініціали назви на кольорі, стабільному для закладу («SKYFALL» → «SK», «Кав'ярня Ранок» → «КР»)
  const TILES = ["#2f6a1c", "#c2410c", "#7c3a8c", "#1f6f8b", "#8a5a12", "#b0305a", "#3d5a80", "#4e8f27"];
  const mono = (n) => {
    const w = String(n).replace(/[«»"'’ʼ()]/g, " ").split(/\s+/).filter((x) => /[\p{L}\d]/u.test(x));
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toUpperCase();
  };
  const tile = (n) => TILES[[...String(n)].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % TILES.length];
  const PHOTOS = []; // файли img/poruch/<нік>.jpg, що вже є в репозиторії (щоб не ловити 404)
  // Фото: посилання з таблиці; або ім'я файлу («skyfall.jpg») з img/poruch/; або, якщо порожньо, — img/poruch/<нік в Instagram>.jpg.
  // Немає файлу — лишається іконка категорії (img прибирається onerror).
  const pic = (p) => {
    if (p.photo) return /^https?:/.test(p.photo) ? p.photo : "../img/poruch/" + p.photo.replace(/^.*\//, "");
    const nick = (p.ig || "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
    return PHOTOS.includes(nick) ? `../img/poruch/${nick}.jpg` : "";
  };
  // «380…», «067…», «+38 (067)…» → +380XXXXXXXXX, щоб дзвінок працював з будь-якого телефону
  const tel = (v) => { const d = String(v).replace(/\D/g, ""); return d.length === 12 && d.startsWith("380") ? "+" + d : d.length === 10 && d.startsWith("0") ? "+38" + d : String(v).replace(/[^\d+]/g, ""); };
  const yes = (v) => /^(так|yes|1|true|✅|є)/i.test(v || "");
  const where = (p) => {
    const u = UNITS[p.unit];
    const sec = u ? u[0] : p.sec, side = u ? u[1] : p.side;
    return [sec ? `Секція ${sec}` : "", /двір/i.test(side) ? "вхід з двору" : /вулиц/i.test(side) ? "вхід з вулиці" : ""].filter(Boolean).join(" · ");
  };
  const enrich = (p, i) => {
    p.i = i; p.week = parseHours(p.hours); p.st = status(p.week); p.bolt = yes(p.noPower);
    const till = p.dealTill ? parseDate(p.dealTill) : null;
    p.dealOn = !!p.deal && (!till || till >= new Date());
    p.tillText = till ? "до " + till.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }) : "";
    // точка на карті: приміщення з альбому, інакше — перше приміщення секції з потрібного боку
    let u = UNITS[p.unit];
    if (!u) {
      const side = /двір/i.test(p.side) ? "Двір" : "Вулиця";
      u = Object.values(UNITS).find((x) => String(x[0]) === String(p.sec) && x[1] === side);
    }
    p.xy = u ? [u[2], u[3]] : null;
    return p;
  };

  const match = (p) => filter === "all" || (filter === "open" && p.st?.open) || (filter === "bolt" && p.bolt) || (filter === "deal" && p.dealOn) || filter === "cat:" + p.cat;

  const drawChips = () => {
    const cats = [...new Set(places.map((p) => p.cat).filter(Boolean))];
    const chips = [["all", "Усі"], ["open", "🟢 Відкрито зараз"], ["bolt", "🔋 Працюють при відключеннях"], ["deal", "🎁 Акції"], ...cats.map((c) => ["cat:" + c, icon(c) + " " + c])];
    $("#chips").innerHTML = places.length ? chips.map(([k, t]) => `<button type="button" class="pr-chip${k === filter ? " on" : ""}" data-f="${esc(k)}">${esc(t)}</button>`).join("") : "";
  };

  const drawMap = () => {
    const used = {};
    const pins = places.filter((p) => p.xy).map((p) => {
      const key = p.xy.join(), n = (used[key] = (used[key] || 0) + 1) - 1;
      const [x, y] = [p.xy[0] + (n % 3) * 34 - (n ? 17 : 0), p.xy[1] - Math.floor(n / 3) * 34 - (n ? 8 : 0)];
      const dim = match(p) ? "" : " dim";
      return `<g class="pin${dim}${p.bolt ? " bolt" : ""}" data-i="${p.i}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${esc(p.name)}">
        <circle r="26" class="pin__c ${p.st?.open ? "open" : p.st ? "closed" : ""}"/><text class="pin__t" dy="9">${icon(p.cat)}</text>${p.bolt ? '<text class="pin__b" x="19" y="-14">🔋</text>' : ""}</g>`;
    }).join("");
    const taken = new Set(places.map((p) => p.unit));
    const units = Object.entries(UNITS).filter(([k]) => !taken.has(k))
      .map(([k, [, side, x, y]]) => `<g class="unit unit--${side === "Двір" ? "yard" : "street"}" transform="translate(${x} ${y})"><circle r="11"/><title>Приміщення ${k} · ${side === "Двір" ? "вхід з двору" : "вхід з вулиці"}</title></g>`).join("");
    $("#map").innerHTML = `
      <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#3c3214" flood-opacity=".22"/></filter></defs>
      <polygon class="yard" points="${SHAPES.yard}"/>
      <text class="yard__t" x="560" y="440">двір · стилобат</text>
      <g filter="url(#sh)">${["s1", "s2", "s3", "s4"].map((k) => `<polygon class="bld" points="${SHAPES[k]}"/>`).join("")}</g>
      ${BADGES.map(([n, x, y]) => `<g class="badge" transform="translate(${x} ${y})"><circle r="22"/><text dy="8">${n}</text></g>`).join("")}
      <text class="street" x="640" y="14">вул. Воскресенська</text>
      <text class="street" transform="translate(150 300) rotate(-72)">бул. Перова</text>
      ${units}${pins}`;
  };

  const card = (p) => `
    <article class="pr-card${match(p) ? "" : " hide"}" id="p${p.i}" data-i="${p.i}">
      <div class="pr-card__pic" style="--tile:${tile(p.name)}"><span class="pr-mono">${esc(mono(p.name))}</span><i class="pr-cat" title="${esc(p.cat || "")}">${icon(p.cat)}</i>${pic(p) ? `<img src="${esc(pic(p))}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
      <div class="pr-card__body">
        <h3>${esc(p.name)}</h3>
        <p class="pr-card__meta">${esc([p.cat, where(p)].filter(Boolean).join(" · "))}</p>
        ${p.bolt ? `<p class="pr-power-ok" title="Має резервне живлення — працює, навіть коли світла немає">🔋 Працює при відключеннях</p>` : ""}
        ${p.st ? `<p class="pr-st ${p.st.open ? "on" : "off"}"><i></i>${esc(p.st.text)}</p>` : ""}
        ${p.about ? `<p class="pr-card__about">${esc(p.about)}</p>` : ""}
        ${p.dealOn ? `<p class="pr-card__deal">🎁 ${esc(p.deal)}${p.tillText ? ` <small>${esc(p.tillText)}</small>` : ""}</p>` : ""}
        ${p.hours ? `<details class="pr-card__hours"><summary>Графік</summary>${esc(p.hours).replace(/;\s*/g, "<br>")}</details>` : ""}
        <div class="pr-card__act">
          ${p.phone ? `<a class="pr-a" href="tel:${esc(tel(p.phone))}">📞 Подзвонити</a>` : ""}
          ${p.ig ? `<a class="pr-a" href="${esc(/^https?:/.test(p.ig) ? p.ig : "https://instagram.com/" + p.ig.replace(/^@/, ""))}" target="_blank" rel="noopener">Instagram</a>` : ""}
          ${p.site ? `<a class="pr-a" href="${esc(/^https?:/.test(p.site) ? p.site : "https://" + p.site)}" target="_blank" rel="noopener">Сайт</a>` : ""}
          ${p.xy ? `<button class="pr-a" type="button" data-map="${p.i}">📍 На карті</button>` : ""}
        </div>
      </div>
    </article>`;

  const drawList = () => {
    if (!places.length) {
      $("#list").innerHTML = `<div class="card pr-empty"><b>Заклади додаються</b><p>Збираємо інформацію про кав'ярні, магазини й сервіси в нашому ЖК. Точки на карті — 30 комерційних приміщень ЖК: зелені виходять у двір, білі — на вулицю.</p></div>`;
      return;
    }
    const sorted = places.slice().sort((a, b) => (b.st?.open ? 1 : 0) - (a.st?.open ? 1 : 0) || (b.dealOn ? 1 : 0) - (a.dealOn ? 1 : 0));
    const shown = sorted.filter(match).length;
    $("#list").innerHTML = sorted.map(card).join("") + (shown ? "" : `<p class="pr-none">Нічого не знайшли за цим фільтром.</p>`);
  };

  const drawDeals = () => {
    const deals = places.filter((p) => p.dealOn);
    $("#deals").hidden = !deals.length;
    $("#deals-row").innerHTML = deals.map((p) => `<button type="button" class="pr-deal" data-map="${p.i}"><span>${icon(p.cat)}</span><b>${esc(p.deal)}</b><small>${esc(p.name)}${p.tillText ? " · " + esc(p.tillText) : ""}</small></button>`).join("");
  };

  const drawPower = () => {
    const el = $("#power");
    if (!lightOff || !places.length) { el.hidden = true; return; }
    const bolt = places.filter((p) => p.bolt);
    el.hidden = false;
    el.innerHTML = bolt.length
      ? `<b>🕯 Світла немає.</b> Мають резервне живлення й працюють: ${bolt.map((p) => esc(p.name)).join(", ")}. <button type="button" class="pr-chip on" data-f="bolt">Показати 🔋</button>`
      : `<b>🕯 Світла немає.</b> Поки жоден заклад не позначив роботу під час відключень.`;
  };

  const draw = () => { places.forEach((p) => (p.st = status(p.week))); drawChips(); drawMap(); drawList(); drawDeals(); drawPower(); };

  const focus = (i) => {
    const c = document.getElementById("p" + i); if (!c) return;
    if (c.classList.contains("hide")) { filter = "all"; draw(); return focus(i); }
    document.querySelectorAll(".pr-card.sel, .pin.sel").forEach((x) => x.classList.remove("sel"));
    c.classList.add("sel"); document.querySelector(`.pin[data-i="${i}"]`)?.classList.add("sel");
    c.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; draw(); return; }
    const pin = e.target.closest(".pin"); if (pin) return focus(+pin.dataset.i);
    const m = e.target.closest("[data-map]");
    if (m) { const i = +m.dataset.map; $(".pr-map").scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelectorAll(".pin.sel, .pr-card.sel").forEach((x) => x.classList.remove("sel"));
      document.querySelector(`.pin[data-i="${i}"]`)?.classList.add("sel"); document.getElementById("p" + i)?.classList.add("sel"); }
  });
  document.addEventListener("keydown", (e) => { const pin = e.target.closest?.(".pin"); if (pin && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); focus(+pin.dataset.i); } });

  const start = (list, note) => { places = list.map(enrich); draw(); $("#src").textContent = note; };
  draw();
  if (demo) start(DEMO.slice(), "Режим прикладу: заклади вигадані, щоб показати, як виглядатиме сторінка.");
  else if (S.poruchUrl) {
    fetch(S.poruchUrl + "?places=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => start(Array.isArray(d.places) ? d.places : [], "Дані надають самі заклади. Помітили помилку — надішліть виправлення через «Додати заклад»."))
      .catch(() => start([], ""));
  } else if (S.poruchCsv) {
    fetch(S.poruchCsv, { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => start(toPlaces(parseCsv(t)), "Дані надають самі заклади."))
      .catch(() => start([], ""));
  }
  setInterval(() => places.length && draw(), 60e3); // «відкрито / зачинено» оновлюється щохвилини

  // ---------- Форма «Додати заклад» → Apps Script таблиці (у «Заклади» з «Показувати = ні») ----------
  const dlg = $("#add"), form = $("#add-form"), msg = (t, cls) => { $("#add-msg").textContent = t; $("#add-msg").className = "pr-dlg__msg " + (cls || ""); };
  $("#add-unit").innerHTML = '<option value="">Не знаю номер</option>' + Object.entries(UNITS)
    .sort(([a], [b]) => a.localeCompare(b, "uk", { numeric: true }))
    .map(([k, [s, side]]) => `<option value="${k}">${k} · секція ${s} · ${side === "Двір" ? "з двору" : "з вулиці"}</option>`).join("");
  const syncWhere = () => ($("#add-where").hidden = !!$("#add-unit").value);
  $("#add-unit").addEventListener("change", syncWhere); syncWhere();
  $("#add-open").onclick = () => {
    msg(S.poruchUrl ? "" : "Прийом заявок відкриється найближчим часом.");
    $("#add-send").disabled = !S.poruchUrl;
    dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
  };
  $("#add-close").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // клік повз вікно
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    f.noPower = !!form.noPower.checked;
    if (f.dealTill) f.dealTill = f.dealTill.split("-").reverse().join(".");
    if (f.unit) { f.sec = String(UNITS[f.unit][0]); f.side = UNITS[f.unit][1]; } // секція й вхід — з приміщення
    if (!f.name.trim() || !f.about.trim()) return msg("Вкажіть назву і що пропонуєте", "err");
    if (!f.contact.trim()) return msg("Залиште контакт — він не публікується, лише щоб уточнити деталі", "err");
    $("#add-send").disabled = true; msg("Надсилаємо…");
    // text/plain — «простий» запит без preflight; Apps Script відповідає з CORS *
    fetch(S.poruchUrl, { method: "POST", body: JSON.stringify(f), headers: { "Content-Type": "text/plain;charset=utf-8" } })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || "Не вдалося надіслати");
        form.reset(); syncWhere();
        msg("Дякуємо! Заявку отримали — перевіримо й додамо заклад на сторінку.", "ok");
      })
      .catch((err) => msg(err.message && err.message !== "Failed to fetch" ? err.message : "Не вдалося надіслати. Спробуйте ще раз.", "err"))
      .finally(() => ($("#add-send").disabled = false));
  });

  // Світло: коли його немає — показуємо, хто працює на резервному живленні
  if (window.Power) Power.watch((d) => {
    const last = d.events[d.events.length - 1];
    const off = !!last && !last.on;
    if (off !== lightOff) { lightOff = off; drawPower(); }
  });
})();
