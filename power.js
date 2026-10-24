// Дані про світло для шапки (app.js) і сторінки /svitlo/ (svitlo.js) —
// з API світлобота @power_po2: https://light.rmn.pp.ua/api (доки: /api/docs, /llms.txt).
// CORS відкритий для https://po2.kyiv.ua, токенів не треба.
//   /power-status        — живий стан { status: on|off, timestamp, group: "5.1" }
//   /events?location=home — історія перемикань [{ status, timestamp }], від нових до старих
//   /schedule/home        — графік на сьогодні/завтра { status, slots }
window.Power = (function () {
  const API = "https://light.rmn.pp.ua/api";
  const get = (path) => fetch(API + path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

  // Слот графіка → ["HH:MM", "HH:MM"]. Хвилини від півночі (як у YASNO), години або рядки.
  const hhmm = (v) => {
    if (typeof v === "string") { const m = v.match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }
    if (typeof v !== "number") return null;
    const min = v > 24 ? v : v * 60;
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(Math.round(min % 60)).padStart(2, "0");
  };
  const slot = (s) => {
    if (Array.isArray(s)) return [hhmm(s[0]), hhmm(s[1])];
    if (s && typeof s === "object") {
      // YASNO ділить усю добу на шматки: "Definite" — відключення, "NotPlanned" — світло є,
      // "Possible" — можливе. Показуємо лише відключення (невідомий тип — теж, щоб не загубити графік).
      if (s.type && !/definite|outage|off/i.test(s.type) && /not.?planned|possible|maybe|^on$|power.?on/i.test(s.type)) return null;
      return [hhmm(s.start ?? s.from), hhmm(s.end ?? s.to)];
    }
    return null;
  };
  const day = (d) => {
    const slots = (d.slots || []).map(slot).filter((x) => x && x[0] && x[1]);
    return { slots, emergency: /emergency/i.test(d.status || ""), noOutages: !slots.length && !/emergency|waiting/i.test(d.status || "") };
  };

  let events = null, live = null, sched = null;

  // → { events: [{t, on}] за зростанням часу, schedules: { "YYYY-MM-DD": {slots, emergency, noOutages} }, group }
  const build = () => {
    const ev = (events || []).map((e) => ({ t: e.timestamp, on: e.status === "on" }))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    if (live && /^(on|off)$/.test(live.status) && live.timestamp) {
      const last = ev[ev.length - 1], on = live.status === "on";
      // power-status оновлюється щохвилини, events — рідше: якщо стан уже змінився, додаємо подію
      if (!last || (last.on !== on && Date.parse(live.timestamp) >= Date.parse(last.t))) ev.push({ t: live.timestamp, on });
    }
    const schedules = {};
    for (const d of [sched?.schedule?.today, sched?.schedule?.tomorrow]) if (d?.date) schedules[d.date.slice(0, 10)] = day(d);
    return { events: ev, schedules, group: live?.group || live?.yasno_group, updatedAt: new Date().toISOString() };
  };

  const loadLive = () => get("/power-status").then((d) => (live = d)).catch(() => {});
  const loadRest = () => Promise.all([
    get("/events?location=home&limit=100").then((d) => (events = d)).catch(() => {}),
    get("/schedule/home").then((d) => (sched = d)).catch(() => {}),
  ]);

  // onData(дані) — після кожного оновлення; onFail — якщо API не відповідає.
  const watch = (onData, onFail) => {
    const emit = () => (events || live) ? onData(build()) : onFail && onFail();
    Promise.all([loadLive(), loadRest()]).then(emit);
    setInterval(() => loadLive().then(emit), 60e3);      // стан — щохвилини
    setInterval(() => loadRest().then(emit), 5 * 60e3);  // історія й графік — раз на 5 хв
    setInterval(() => (events || live) && emit(), 30e3); // «уже N хв»
  };
  return { watch };
})();
