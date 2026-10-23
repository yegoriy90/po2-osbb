// Дані про світло для шапки (app.js) і сторінки /svitlo/ (svitlo.js).
// Два джерела, які доповнюють одне одного:
//  • API світлобота https://light.rmn.pp.ua — живий стан і графік (CORS відкритий для po2.kyiv.ua);
//  • power.json з гілки power-data — історія подій із каналу @power_po2 (tools/power_fetch.py).
// Якщо одне з джерел недоступне, працює інше.
window.Power = (function () {
  const API = "https://light.rmn.pp.ua/api";
  const RAW = "https://raw.githubusercontent.com/yegoriy90/po2-osbb/power-data/power.json";
  const get = (url) => fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

  // Слот графіка → ["HH:MM", "HH:MM"]. Приймаємо хвилини від півночі (як у YASNO), години або рядки.
  const hhmm = (v) => {
    if (typeof v === "string") { const m = v.match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }
    if (typeof v !== "number") return null;
    const min = v > 24 ? v : v * 60;
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(Math.round(min % 60)).padStart(2, "0");
  };
  const slot = (s) => {
    if (Array.isArray(s)) return [hhmm(s[0]), hhmm(s[1])];
    if (s && typeof s === "object") {
      if (s.type && /possible|maybe/i.test(s.type)) return null; // «можливі» не показуємо як планові
      return [hhmm(s.start ?? s.from ?? s.begin), hhmm(s.end ?? s.to ?? s.finish)];
    }
    return null;
  };
  const apiDay = (d) => d && {
    slots: (d.slots || []).map(slot).filter((x) => x && x[0] && x[1]),
    emergency: /emergency/i.test(d.status || ""),
    noOutages: /no.?outage|normal/i.test(d.status || "") && !(d.slots || []).length,
  };
  const dayKey = (iso) => (iso || "").slice(0, 10);

  // Зливає power.json (історія) з живими даними API.
  const merge = (hist, live, sched) => {
    const out = { events: (hist?.events || []).slice(), schedules: { ...(hist?.schedules || {}) }, updatedAt: hist?.updatedAt, live: false };
    if (live && (live.status === "on" || live.status === "off") && live.timestamp) {
      const last = out.events[out.events.length - 1], on = live.status === "on";
      // API знає про перемикання раніше, ніж Actions встигне прочитати канал, — додаємо подію
      if ((!last || last.on !== on) && (!last || Date.parse(live.timestamp) > Date.parse(last.t))) {
        out.events.push({ id: "api", t: live.timestamp, on });
      }
      out.live = true;
      out.updatedAt = new Date().toISOString();
    }
    const s = sched?.schedule;
    if (s) {
      for (const d of [s.today, s.tomorrow]) {
        const k = dayKey(d?.date), a = apiDay(d);
        if (!k || !a) continue;
        const old = out.schedules[k] || {};
        // Слоти — з API, якщо вони там є; інакше лишаємо з каналу (API в «екстрених» віддає порожні)
        out.schedules[k] = { ...old, slots: a.slots.length ? a.slots : (old.slots || []), emergency: a.emergency, noOutages: a.noOutages && !(old.slots || []).length };
      }
    }
    return out;
  };

  let hist = null, live = null, sched = null;
  const src = new URLSearchParams(location.search).get("src"); // ?src=файл — локальна перевірка без API
  const loadHist = () => get(src || RAW).then((d) => (hist = d)).catch(() => {});
  const loadLive = () => src ? Promise.resolve() : Promise.all([
    get(API + "/power-status").then((d) => (live = d)).catch(() => {}),
    get(API + "/schedule/home").then((d) => (sched = d)).catch(() => {}),
  ]);

  // onData(merged) — викликається після кожного оновлення; onFail — якщо обидва джерела мовчать.
  const watch = (onData, onFail) => {
    const emit = () => (hist || live) ? onData(merge(hist, live, sched)) : onFail && onFail();
    Promise.all([loadHist(), loadLive()]).then(emit);
    setInterval(() => loadLive().then(emit), 60e3);      // живий стан — щохвилини
    setInterval(() => loadHist().then(emit), 5 * 60e3);  // історія — раз на 5 хв
    setInterval(() => (hist || live) && emit(), 30e3);   // «уже N хв»
  };
  return { watch };
})();
