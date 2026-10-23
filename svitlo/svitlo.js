(function () {
  // Дані — з ../power.js (API світлобота + історія power.json).
  const $ = (s) => document.querySelector(s);
  const H = 3600e3, DAY = 24 * H;
  const TZ = "Europe/Kyiv";

  // ---------- Час по Києву ----------
  const fmt = (opts) => new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, ...opts });
  const hm = (t) => fmt({ hour: "2-digit", minute: "2-digit" }).format(t);
  const hmEnd = (t) => (hm(t) === "00:00" ? "24:00" : hm(t)); // кінець слота опівночі
  const dayKey = (t) => fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  const key = (t) => { const p = dayKey(t); return `${p.year}-${p.month}-${p.day}`; };
  const offsetAt = (t) => { // різниця Київ − UTC у мс
    const p = fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(t).reduce((o, x) => ((o[x.type] = +x.value || x.value), o), {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  };
  const midnight = (k) => { const g = Date.parse(k + "T00:00:00Z"); return g - offsetAt(g - offsetAt(g)); };
  const at = (k, hhmm) => midnight(k) + (+hhmm.slice(0, 2)) * H + (+hhmm.slice(3)) * 60e3;
  const weekday = (t) => fmt({ weekday: "short", day: "2-digit", month: "2-digit" }).format(t);

  const dur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60e3)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return [d && `${d} д`, h && `${h} год`, (mm || (!d && !h)) && `${mm} хв`].filter(Boolean).join(" ");
  };

  // ---------- Події → інтервали ----------
  // [{from, to, on}] — від першої відомої події до «зараз». prev першої події дає ще один інтервал назад.
  const intervals = (events, now) => {
    const ev = events.map((e) => ({ t: Date.parse(e.t), on: e.on, prev: e.prev })).sort((a, b) => a.t - b.t);
    const out = [];
    if (ev.length && ev[0].prev) out.push({ from: ev[0].t - ev[0].prev * 1e3, to: ev[0].t, on: !ev[0].on });
    ev.forEach((e, i) => out.push({ from: e.t, to: i + 1 < ev.length ? ev[i + 1].t : now, on: e.on }));
    return out;
  };
  const offIn = (iv, a, b) => iv.reduce((s, x) => s + (x.on ? 0 : Math.max(0, Math.min(b, x.to) - Math.max(a, x.from))), 0);
  const known = (iv, a, b) => iv.reduce((s, x) => s + Math.max(0, Math.min(b, x.to) - Math.max(a, x.from)), 0);

  const bar = (iv, a, b, plan, now) => {
    const pct = (t) => ((Math.min(b, Math.max(a, t)) - a) / (b - a)) * 100;
    const seg = iv.filter((x) => x.to > a && x.from < b)
      .map((x) => `<i class="${x.on ? "on" : "off"}" style="left:${pct(x.from)}%;width:${pct(x.to) - pct(x.from)}%"></i>`).join("");
    const pl = (plan || []).map(([s, e]) => [at(key(a + H), s), e === "24:00" || e === "00:00" ? b : at(key(a + H), e)])
      .map(([s, e]) => `<i style="left:${pct(s)}%;width:${pct(e) - pct(s)}%"></i>`).join("");
    const mark = now > a && now < b ? `<span class="pw-now-mark" style="left:${pct(now)}%"></span>` : "";
    return { plan: pl, bar: seg + mark };
  };

  const render = (D) => {
    const now = Date.now();
    const iv = intervals(D.events || [], now);
    const last = iv[iv.length - 1];
    const today = key(now), tomorrow = key(now + DAY);
    const sched = D.schedules || {};

    // ---- Зараз ----
    const box = $("#now");
    if (!last) {
      box.dataset.state = "na";
      $("#now-label").textContent = "Поки немає даних";
      $("#now-since").textContent = "Історія збирається з каналу @power_po2 — з'явиться після першої події.";
    } else {
      box.dataset.state = last.on ? "on" : "off";
      $("#now-label").textContent = last.on ? "💡 Світло є" : "🕯 Світла немає";
      $("#now-since").innerHTML = `з ${hm(last.from)}${key(last.from) !== today ? ` (${weekday(last.from)})` : ""} · уже <b>${dur(now - last.from)}</b>`;
    }
    // найближчий плановий слот
    const slots = [today, tomorrow].flatMap((k) => (sched[k]?.slots || []).map(([s, e]) => ({ s: at(k, s), e: e === "24:00" || e === "00:00" ? midnight(k) + DAY : at(k, e) })));
    const cur = slots.find((x) => x.s <= now && now < x.e), next = slots.find((x) => x.s > now);
    const emergency = sched[today]?.emergency;
    $("#now-plan").classList.toggle("pw-now__plan--alert", !!emergency);
    $("#now-plan").textContent = emergency ? "⚠ Екстрені відключення"
      : cur ? `За графіком зараз відключення до ${hmEnd(cur.e)}`
      : next ? `Наступне за графіком: ${key(next.s) === today ? "сьогодні" : "завтра"} ${hm(next.s)}–${hmEnd(next.e)}` : "";

    // ---- Сьогодні ----
    const a = midnight(today), b = a + DAY;
    const t = bar(iv, a, b, sched[today]?.slots, now);
    // Екстрені: графік не діє, світло можуть вимкнути будь-коли — суцільна смуга на всю добу
    const plan = emergency ? '<i class="emerg"></i>' : t.plan;
    const label = emergency ? '<p class="pw-emerg-label"><b>⚠ Екстрені відключення</b> графік не діє, світло можуть вимкнути будь-коли</p>' : "";
    $("#today").innerHTML = `${label}<div class="pw-plan${emergency ? " pw-plan--emerg" : ""}">${plan}</div><div class="pw-bar">${t.bar}</div>
      <div class="pw-ticks"><span style="left:0">00</span><span style="left:25%">06</span><span style="left:50%">12</span><span style="left:75%">18</span><span style="left:100%">24</span></div>`;
    document.querySelector(".pw-legend .lg-emerg").hidden = !emergency;
    document.querySelector(".pw-legend .lg-plan").hidden = !!emergency;
    $("#today-total").textContent = known(iv, a, Math.min(b, now)) ? `без світла: ${dur(offIn(iv, a, Math.min(b, now)))}` : "";

    // ---- Графік ----
    const dayPlan = (k, label) => {
      const s = sched[k];
      if (!s) return `<div class="pw-day-plan"><h3>${label}</h3><p>Графіка ще немає.</p></div>`;
      const items = s.slots.map(([x, y]) => {
        const xs = at(k, x), ye = y === "24:00" || y === "00:00" ? midnight(k) + DAY : at(k, y);
        const cls = ye <= now ? "past" : xs <= now ? "now" : "";
        return `<li class="${cls}"><span>${x} – ${y}</span><span>${dur(ye - xs)}</span></li>`;
      }).join("");
      const total = s.slots.reduce((n, [x, y]) => n + ((y === "24:00" || y === "00:00" ? midnight(k) + DAY : at(k, y)) - at(k, x)), 0);
      return `<div class="pw-day-plan"><h3>${label}, ${weekday(midnight(k) + H)}</h3>
        ${s.emergency ? '<div class="pw-alert">🚨 Екстрені відключення — графіки не застосовуються</div>' : ""}
        ${s.slots.length ? `<ul>${items}</ul><p>Усього за графіком: ${dur(total)}</p>` : `<p>${s.emergency ? "Графік не діє — світло можуть вимкнути будь-коли." : s.noOutages ? "Відключень не заплановано 🎉" : "Планових відключень немає."}</p>`}</div>`;
    };
    $("#sched").innerHTML = dayPlan(today, "Сьогодні") + dayPlan(tomorrow, "Завтра");

    // ---- Тиждень ----
    let weekOff = 0;
    $("#week").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const k = key(now - (6 - i) * DAY), s = midnight(k), e = Math.min(s + DAY, now);
      const r = bar(iv, s, s + DAY, null, now), off = offIn(iv, s, e), has = known(iv, s, e) > 0;
      weekOff += off;
      return `<div class="pw-row"><span>${weekday(s + H)}</span><div class="pw-bar">${r.bar}</div><b>${has ? dur(off) : "—"}</b></div>`;
    }).join("");
    $("#week-total").textContent = iv.length ? `без світла: ${dur(weekOff)}` : "";

    // ---- Свіжість ----
    $("#updated").textContent = `стан наживо · перевірено ${hm(Date.parse(D.updatedAt))}`;
    if (D.group) document.querySelectorAll(".js-group").forEach((el) => (el.textContent = "група " + D.group));
  };

  Power.watch(render, () => {
    $("#now").dataset.state = "na";
    $("#now-label").textContent = "Не вдалося завантажити";
    $("#now-since").innerHTML = 'Дивіться канал <a href="https://t.me/power_po2" style="color:inherit">@power_po2</a>';
  });
})();
