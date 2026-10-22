(function () {
  const S = window.SITE;
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => n.toLocaleString("uk-UA");
  const pctStr = (p) => p.toFixed(1).replace(".", ",").replace(",0", "") + "%";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-bind]").forEach((el) => (el.textContent = S[el.dataset.bind] || ""));
  document.querySelectorAll("[data-href]").forEach((el) => (el.href = S[el.dataset.href]));

  // ---------- Голоси ----------
  // votes: { updatedAt, baseArea, dahArea, apartments: [[номер, 0|1], ...] }
  const parseCsv = (text) => {
    const rows = text.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
    const yes = (v) => /✅|^1$|так|true/i.test((v || "").trim());
    const nums = (v) => parseFloat(String(v || "").replace(",", "."));
    const known = rows.map((r) => nums(r[1])).filter((x) => x > 0).sort((x, y) => x - y);
    const fill = known[known.length >> 1] || 0;
    let dahArea = 0;
    const apartments = rows.filter((r) => parseInt(r[0])).map((r) => {
      const on = yes(r[2]);
      if (on) dahArea += nums(r[1]) || fill;
      return [parseInt(r[0]), on ? 1 : 0];
    });
    return { updatedAt: new Date().toISOString(), baseArea: window.VOTES.baseArea, dahArea, apartments };
  };

  const render = (V) => {
    const dah = new Map(V.apartments);
    const total = V.apartments.length;
    const inDah = V.apartments.filter((a) => a[1]).length;
    const pct = (V.dahArea / V.baseArea) * 100;
    const goal = S.threshold * 100;
    const leftArea = Math.max(0, V.baseArea * S.threshold - V.dahArea);
    const leftApts = Math.ceil(leftArea / S.avgArea); // середня площа ще не зареєстрованих квартир

    $("#updated").textContent = new Date(V.updatedAt).toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    $("#c-total").textContent = num(total);
    $("#c-left").innerHTML = pct > goal
      ? "<b>Більшість є!</b> Готуємо реєстрацію ОСББ"
      : `До мети ще <b>${num(Math.ceil(leftArea))} м²</b> · це ≈ ${num(leftApts)} квартир`;
    document.querySelectorAll(".js-pct").forEach((el) => (el.textContent = pctStr(pct)));
    document.querySelectorAll(".js-left-m2").forEach((el) => (el.textContent = num(Math.ceil(leftArea / 10) * 10) + " м²"));
    document.querySelectorAll(".js-left-apts").forEach((el) => (el.textContent = "≈" + num(leftApts)));
    $("#bar-goal").style.left = goal + "%";
    $("#bar").setAttribute("aria-valuenow", pct.toFixed(1));

    const countUp = () => {
      $("#bar-fill").style.width = Math.min(100, pct) + "%";
      if (reduce) { $("#c-pct").textContent = pctStr(pct); $("#c-voted").textContent = num(inDah); return; }
      const t0 = performance.now(), dur = 1400;
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        $("#c-pct").textContent = pctStr(pct * e);
        $("#c-voted").textContent = num(Math.round(inDah * e));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    setTimeout(countUp, 250);

    // ---------- Будинок ----------
    // "2:3, 3-19:10" → { 2: [1, 2, 3], 3: [4..13], ... }
    const parseLayout = (sec) => {
      const floors = {};
      let n = sec.first;
      sec.layout.split(",").forEach((part) => {
        const [fl, cnt] = part.trim().split(":");
        const [f1, f2 = f1] = fl.split("-").map(Number);
        for (let f = f1; f <= f2; f++) {
          floors[f] = [];
          for (let i = 0; i < +cnt; i++) {
            const num = n++;
            floors[f].push(...(S.split[num] ? [] : [num]));
            if (S.split[num]) { floors[f].push(...S.split[num]); i += S.split[num].length - 1; }
          }
        }
      });
      return floors;
    };

    const W = 16, H = 13, GX = 6, GY = 8, PAD = 14, ROOF = 26, GROUND = 50;
    town.innerHTML = S.sections.map((s, si) => {
      const floors = parseLayout(s);
      const top = Math.max(...Object.keys(floors).map(Number));
      const rows = top - 1; // житлові поверхи 2..top
      const per = Math.max(...Object.values(floors).map((f) => f.length));
      const bw = PAD * 2 + per * W + (per - 1) * GX;
      const bh = ROOF + PAD + rows * H + (rows - 1) * GY + PAD + GROUND;
      let win = "", lit = "", on = 0, known = 0;
      for (let f = 2; f <= top; f++) {
        const list = floors[f] || [];
        const y = ROOF + PAD + (top - f) * (H + GY);
        const off = ((per - list.length) * (W + GX)) / 2;
        list.forEach((apt, c) => {
          const x = PAD + off + c * (W + GX);
          const st = dah.get(apt);
          if (st === undefined) { win += `<rect class="w w--none" data-apt="${apt}" data-na="1" x="${x}" y="${y}" width="${W}" height="${H}" rx="2"/>`; return; }
          known++;
          if (st) {
            on++;
            lit += `<g class="w w--on" data-apt="${apt}" data-floor="${f}" style="animation-delay:${(Math.random() * 1.8).toFixed(2)}s"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="2"/><path d="M${x + W / 2} ${y + 2}V${y + H - 2}"/></g>`;
          } else {
            win += `<rect class="w" data-apt="${apt}" data-floor="${f}" x="${x}" y="${y}" width="${W}" height="${H}" rx="2"/>`;
          }
        });
      }
      const gy = bh - GROUND, door = bw / 2 - 14, roofBox = si % 2 ? bw - 70 : 30;
      return `<figure class="bld">
        <figcaption>${esc(s.name)}</figcaption>
        <svg viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}" role="img" aria-label="${esc(s.name)}: ${on} з ${known} квартир у ДАХ">
          <rect class="roofbox" x="${roofBox}" y="2" width="40" height="${ROOF - 2}" rx="2"/>
          <rect class="vent" x="${roofBox + 8}" y="9" width="10" height="10" rx="1"/>
          <rect class="body" x="0" y="${ROOF}" width="${bw}" height="${bh - ROOF}" rx="3"/>
          <rect class="cornice" x="-4" y="${ROOF - 4}" width="${bw + 8}" height="6" rx="2"/>
          ${win}<g class="lit">${lit}</g>
          <rect class="plinth" x="0" y="${gy}" width="${bw}" height="${GROUND}"/>
          <rect class="shop" x="10" y="${gy + 12}" width="${door - 20}" height="${GROUND - 24}" rx="2"/>
          <rect class="shop" x="${door + 38}" y="${gy + 12}" width="${bw - door - 48}" height="${GROUND - 24}" rx="2"/>
          <rect class="door" x="${door}" y="${gy + 12}" width="28" height="${GROUND - 12}" rx="2"/>
          <rect class="lamp" x="${door + 9}" y="${gy + 5}" width="10" height="4" rx="2"/>
        </svg>
        <div class="bld__meta"><span>${on} / ${known} квартир</span><b>${Math.round((on / known) * 100)}%</b></div>
      </figure>`;
    }).join("");
    town.classList.remove("go");
    new IntersectionObserver((es, o) => es.forEach((e) => e.isIntersecting && (town.classList.add("go"), o.disconnect())), { threshold: 0.15 }).observe(town);
    shareText = `Сусіди, вже ${inDah} квартир у ДАХ (${pctStr(pct)} площі). Потрібно понад 50%, щоб створити ОСББ в «${S.complex}». Зареєструйся: це 2 хвилини.`;
  };

  const town = $("#town");
  let shareText = "";
  render(window.VOTES);
  if (S.sheetCsvUrl) {
    fetch(S.sheetCsvUrl).then((r) => r.ok ? r.text() : Promise.reject()).then((t) => render(parseCsv(t))).catch(() => {});
  }

  const tip = $("#tip");
  let hideT;
  const show = (e) => {
    const w = e.target.closest("[data-apt]");
    if (!w) return;
    const yes = w.classList.contains("w--on");
    tip.innerHTML = `кв. ${w.dataset.apt}${w.dataset.floor ? `, ${w.dataset.floor} пов.` : ""} · ${w.dataset.na ? "немає в реєстрі" : yes ? "<b>уже в ДАХ ✓</b>" : "ще не в ДАХ"}`;
    const r = w.getBoundingClientRect();
    tip.style.left = r.left + r.width / 2 + "px";
    tip.style.top = r.top + "px";
    tip.classList.add("tip--on");
    clearTimeout(hideT);
    hideT = setTimeout(() => tip.classList.remove("tip--on"), 2200);
  };
  town.addEventListener("pointerover", show);
  town.addEventListener("click", show);
  town.addEventListener("scroll", () => tip.classList.remove("tip--on"), { passive: true });
  addEventListener("scroll", () => tip.classList.remove("tip--on"), { passive: true });

  // Парк позаду і озеро попереду
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  let x = -10, trees = "";
  while (x < 1600) {
    const h = 40 + rnd() * 70, r = h * (0.28 + rnd() * 0.12), cy = 130 - h + r;
    trees += rnd() > 0.5
      ? `<path d="M${x} 130 L${x + r} ${130 - h} L${x + 2 * r} 130Z"/>`
      : `<circle cx="${x + r}" cy="${cy}" r="${r}"/><rect x="${x + r - 2}" y="${cy}" width="4" height="${130 - cy}"/>`;
    x += r * (1 + rnd() * 0.8);
  }
  $(".forest").innerHTML = `<svg viewBox="0 0 1600 130">${trees}</svg>`;
  const wave = (y, a) => { let d = `M0 ${y}`; for (let i = 0; i < 1600; i += 40) d += ` q10 ${-a} 20 0 t20 0`; return d; };
  $(".lake").innerHTML = `<svg viewBox="0 0 1600 40"><path d="${wave(14, 4)}"/><path d="${wave(28, 3)}" opacity=".5"/></svg>`;

  // ---------- Біль ----------
  $("#pains").innerHTML = S.pains.map((p) => `<li><span class="x">×</span>${esc(p)}</li>`).join("");

  // ---------- Чому ----------
  const ICON = {
    wallet: '<rect x="4" y="12" width="40" height="28" rx="4"/><path d="M4 18h40M32 28h6"/><path d="M10 12l20-6 4 6"/>',
    vote: '<rect x="8" y="22" width="32" height="20" rx="3"/><path d="M16 22l-2-14h20l-2 14"/><path d="M19 15l4 4 7-8"/>',
    bolt: '<path d="M27 4L10 27h13l-3 17 18-24H25z"/>',
    eye: '<path d="M3 24s8-13 21-13 21 13 21 13-8 13-21 13S3 24 3 24z"/><circle cx="24" cy="24" r="6"/>',
    key: '<circle cx="15" cy="24" r="8"/><path d="M23 24h21M37 24v7M43 24v5"/>',
    shield: '<path d="M24 4l17 6v12c0 11-7 18-17 22C14 40 7 33 7 22V10z"/><path d="M17 24l5 5 9-10"/>',
  };
  $("#why-list").innerHTML = S.why.map((w) => `<article class="why__item card">
      <div class="ico"><svg viewBox="0 0 48 48" aria-hidden="true">${ICON[w.icon] || ""}</svg></div>
      <h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></article>`).join("");

  // ---------- Етапи ----------
  $("#steps-list").innerHTML = S.steps.map((s, i) => {
    const st = i < S.current ? "done" : i === S.current ? "now" : "";
    return `<li class="step ${st}"><span class="step__n">${i < S.current ? "✓" : i + 1}</span>
      <div><h3>${esc(s.title)}${i === S.current ? ' <em class="badge">ми тут</em>' : ""}</h3><p>${esc(s.text)}</p></div></li>`;
  }).join("");

  // ---------- FAQ ----------
  $("#faq-list").innerHTML = S.faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("");

  // ---------- Ініціативна група ----------
  const botCard = `<div class="team__sec team__bot card"><h3>Бот ініціативної групи</h3><p>Допомога з реєстрацією, новини, питання.</p><a class="btn btn--tg btn--sm" href="${esc(S.botUrl)}" target="_blank" rel="noopener">${esc(S.botName)}</a></div>`;
  $("#team-list").innerHTML = S.team.map((t) => `<div class="team__sec card"><h3>${esc(t.section)}</h3>` +
    t.people.map((p) => `<div class="person"><span>${esc(p.name)}</span><a href="${esc(p.tg)}" target="_blank" rel="noopener">Telegram ↗</a></div>`).join("") + "</div>").join("") + botCard;

  // ---------- Поділитися ----------
  $("#share").onclick = async (e) => {
    const data = { title: document.title, text: shareText, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.text + " " + data.url); e.target.textContent = "Посилання скопійовано ✓"; }
    } catch (_) {}
  };
})();
