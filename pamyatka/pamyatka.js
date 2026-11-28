// Пам'ятка мешканця: «шуміти зараз можна?», «УК зараз працює?» і телефони під кнопкою.
// Номери в HTML записані задом наперед (data-t), щоб їх не збирали боти й не індексував пошук.
(function () {
  const S = window.SITE || {};
  const $ = (s) => document.querySelector(s);
  document.querySelectorAll("[data-bind]").forEach((el) => (el.textContent = S[el.dataset.bind] || ""));
  document.querySelectorAll("[data-href]").forEach((el) => (el.href = S[el.dataset.href]));

  // ---------- Телефони ----------
  const fmt = (d) => d.length === 12 ? `+${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`
    : `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button.pm-tel"); if (!b) return;
    const d = [...b.dataset.t].reverse().join(""), intl = d.length === 12 ? "+" + d : "+38" + d;
    const a = document.createElement("a");
    a.className = "pm-tel pm-tel--open";
    a.href = b.hasAttribute("data-viber") ? "viber://chat?number=" + encodeURIComponent(intl) : "tel:" + intl;
    a.textContent = (b.hasAttribute("data-viber") ? "💬 " : "📞 ") + fmt(d);
    b.replaceWith(a);
  });

  // ---------- Зараз (київський час) ----------
  const kyiv = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { d: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday), m: +p.hour * 60 + +p.minute };
  };
  const draw = () => {
    const { d, m } = kyiv(), work = d < 5;
    let cls, txt;
    if (work && m >= 540 && m < 780) { cls = "ok"; txt = "🟢 Зараз шумні роботи можна — до 13:00"; }
    else if (work && m >= 780 && m < 900) { cls = "quiet"; txt = "🤫 Зараз тиха година — шуміти можна з 15:00"; }
    else if (work && m >= 900 && m < 1080) { cls = "ok"; txt = "🟢 Зараз шумні роботи можна — до 18:00"; }
    else {
      const next = work && m < 540 ? "сьогодні" : d < 4 || d === 6 ? "завтра" : "у понеділок";
      cls = "no"; txt = `🔇 Зараз шумні роботи заборонено — можна ${next} з 09:00`;
    }
    $("#noise-now").className = "pm-now " + cls;
    $("#noise-now").textContent = txt + (cls === "no" ? "" : " (якщо сьогодні не свято)");

    // УК: Пн–Чт 08:00–17:00, Пт 08:00–15:45
    const end = d < 4 ? 1020 : d === 4 ? 945 : 0;
    const open = end && m >= 480 && m < end;
    const nextDay = d < 5 && m < 480 ? "сьогодні" : d < 4 || d === 6 ? "завтра" : "у понеділок";
    $("#uk-now").className = "pm-badge " + (open ? "on" : "off");
    $("#uk-now").textContent = open ? `● Працює до ${end === 945 ? "15:45" : "17:00"}` : `● Зачинено · відкриється ${nextDay} о 08:00`;
  };
  draw();
  setInterval(draw, 60e3);
})();
