// Сторінка «Резервне живлення»: живі підсумки з Apps Script (?stats=1) і форма запису.
// На сторінку потрапляють лише суми по секціях — без номерів квартир і контактів.
(function () {
  const S = window.SITE || {};
  const URL_ = S.zbirUrl || "";
  const TOTAL = 725;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("uk-UA").replace(/,/g, " ");
  const uah = (n) => fmt(n) + " грн";
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

  document.querySelectorAll("[data-href]").forEach((a) => { if (S[a.dataset.href]) a.href = S[a.dataset.href]; });
  document.querySelectorAll("[data-bind]").forEach((el) => { if (S[el.dataset.bind]) el.textContent = S[el.dataset.bind]; });

  // ---------------- підсумки
  function render(st) {
    const sec = st.sections || [];
    const sum = (k) => sec.reduce((a, s) => a + (s[k] || 0), 0);
    const yes = sum("yes"), maybe = sum("maybe"), pledged = sum("pledged");
    $("count").dataset.state = "ok";
    $("c-yes").textContent = fmt(yes);
    $("c-pledged").textContent = uah(pledged);
    $("bar-fill").style.width = Math.min(100, (yes / TOTAL) * 100).toFixed(1) + "%";
    $("c-meta").innerHTML = `<b>${(yes / TOTAL * 100).toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%</b> квартир будинку`;
    if (st.updatedAt) {
      const d = new Date(st.updatedAt);
      $("c-updated").textContent = "Оновлено " + d.toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    }
    $("c-median").textContent = st.median ? uah(st.median) : "—";
    $("c-maybe").textContent = fmt(maybe);
    $("c-paid").textContent = st.paid ? uah(st.paid) : "0 грн";
    $("sections").innerHTML = sec.map((s, i) => {
      const p = s.total ? Math.min(100, s.yes / s.total * 100) : 0;
      return `<div class="zb-sec"><h3>Секція ${i + 1}</h3><div class="bar"><div class="bar__fill" style="width:${p.toFixed(1)}%"></div></div>
        <p><b>${s.yes}</b> ${plural(s.yes, "квартира", "квартири", "квартир")} «так»${s.maybe ? ` · ${s.maybe} думають` : ""}<br>${uah(s.pledged)}</p></div>`;
    }).join("");
  }
  function idle(text) {
    $("count").dataset.state = "off";
    $("c-yes").textContent = "0";
    $("c-pledged").textContent = "0 грн";
    $("c-meta").textContent = text;
  }
  function load() {
    if (!URL_) return idle("Збір відкриється найближчим часом");
    fetch(URL_ + "?stats=1", { cache: "no-store" }).then((r) => r.json()).then(render).catch(() => idle("Не вдалося завантажити цифри, оновіть сторінку"));
  }
  load();

  // ---------------- форма
  const form = $("zform"), msg = $("msg"), btn = $("submit"), amount = $("amount");
  const say = (t, cls) => { msg.textContent = t; msg.className = "zb-msg " + (cls || ""); };
  if (!URL_) { btn.disabled = true; say("Форма запрацює найближчим часом. Поки що можна написати в бот " + (S.botName || "") + "."); }

  function sync() {
    const ans = form.answer.value, no = ans === "Ні";
    $("amount-box").hidden = no;
    $("contact-box").hidden = no;
    amount.hidden = form.preset.value !== "other";
  }
  form.addEventListener("change", sync);
  sync();

  function validApt(v) {
    v = v.replace(/\s+/g, "").replace(/[–—]/g, "-");
    if (v === "337-1" || v === "337-2") return v;
    if (!/^\d{1,3}$/.test(v)) return "";
    const n = +v;
    return n >= 1 && n <= 725 && n !== 337 ? String(n) : "";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!URL_) return;
    const aptIn = form.apt, apt = validApt(aptIn.value);
    aptIn.setAttribute("aria-invalid", apt ? "false" : "true");
    if (!apt) return say(aptIn.value.trim() === "337" ? "Квартира 337 розділена: вкажіть 337-1 або 337-2." : "Вкажіть номер квартири від 1 до 725.", "err"), aptIn.focus();
    const answer = form.answer.value;
    if (!answer) return say("Оберіть: так, подумаю чи ні.", "err");
    let sum = 0;
    if (answer !== "Ні") {
      sum = form.preset.value === "other" ? +String(amount.value).replace(/\D/g, "") : +form.preset.value || 0;
      if (answer === "Так" && !sum) return say("Вкажіть, скільки посильно внести.", "err");
      if (!form.contact.value.trim()) return say("Залиште телефон або Telegram, щоб ми могли написати, коли буде кошторис.", "err"), form.contact.focus();
    }
    btn.disabled = true; say("Надсилаємо…");
    const body = JSON.stringify({ apt, answer, amount: sum, name: form.name.value, contact: answer === "Ні" ? "" : form.contact.value, website: form.website.value });
    // text/plain — «простий» запит без preflight, Apps Script віддає відповідь з CORS *
    fetch(URL_, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=utf-8" } })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) throw new Error(res.error || "Помилка");
        say(res.status === "review"
          ? "Дякуємо! Для цієї квартири вже є відповідь з іншим контактом, тож ініціативна група перевірить і зв'яжеться з вами."
          : answer === "Ні" ? "Дякуємо, відповідь врахували." : "Дякуємо! Вас записано. Напишемо, коли буде кошторис.", "ok");
        if (res.stats) render(res.stats);
        form.reset(); sync();
      })
      .catch((err) => say(err.message && err.message !== "Failed to fetch" ? err.message : "Не вдалося надіслати. Спробуйте ще раз або напишіть у бот.", "err"))
      .finally(() => { btn.disabled = false; });
  });
})();
