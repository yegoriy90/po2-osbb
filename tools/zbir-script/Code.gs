/**
 * Збір на резервне живлення — Google Apps Script Web App у таблиці опитування (po2_zbir → Google Таблиці).
 *
 *  • POST (форма на po2.kyiv.ua/zbir/) — заявка: № квартири, готовність, посильна сума, ім'я, контакт.
 *    Кожна заявка пишеться в лог «Заявки». У рядок квартири на аркуші «Опитування» — лише якщо рядок
 *    порожній або контакт той самий; інакше в «Примітка» ставиться ⚠ і рядок лишається як був (розбирає ІГ).
 *  • GET ?stats=1 — публічний JSON: лише суми по секціях. Без номерів квартир, імен і контактів.
 *
 * Аркуш «Опитування», дані з 4-го рядка:
 *   A секція · B № кв. · C площа · D ім'я · E готовність (Так/Подумаю/Ні) · F посильна сума, грн ·
 *   G сплачено, грн (веде ІГ вручну) · H примітка · I контакт · J оновлено
 * Розгортання — tools/zbir-script/README.md.
 */

const Z = {
  sheet: 'Опитування',
  log: 'Заявки',
  first: 4,
  sections: [1, 211, 367, 477],   // перші квартири секцій (як у data.js)
  answers: ['Так', 'Подумаю', 'Ні'],
  maxAmount: 100000,
  perAptPerHour: 5,
};

function doGet(e) {
  if (e && e.parameter && e.parameter.stats) return json_(stats_(true));
  return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">Форма збору — на <a href="https://po2.kyiv.ua/zbir/">po2.kyiv.ua/zbir</a>.</p>');
}

function doPost(e) {
  let f;
  try { f = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Не вдалося прочитати заявку' }); }
  if (f.website) return json_({ ok: true, status: 'saved', stats: stats_(true) }); // приманка для ботів

  const apt = String(f.apt || '').trim().replace(/\s+/g, '').replace(/[–—]/g, '-');
  const answer = Z.answers.indexOf(f.answer) >= 0 ? f.answer : '';
  const amount = Math.round(Number(String(f.amount || '').replace(/[^\d.]/g, '')) || 0);
  const name = String(f.name || '').trim().slice(0, 60);
  const contact = String(f.contact || '').trim().slice(0, 60);
  if (!apt) return json_({ ok: false, error: 'Вкажіть номер квартири' });
  if (!answer) return json_({ ok: false, error: 'Оберіть відповідь' });
  if (amount > Z.maxAmount) return json_({ ok: false, error: 'Перевірте суму' });
  if (answer !== 'Ні' && !contact) return json_({ ok: false, error: 'Залиште телефон або Telegram, щоб ми могли написати, коли буде кошторис' });

  const cache = CacheService.getScriptCache(), rk = 'rate_' + apt, hits = Number(cache.get(rk) || 0);
  if (hits >= Z.perAptPerHour) return json_({ ok: false, error: 'Забагато заявок для цієї квартири. Спробуйте пізніше або напишіть у бот.' });
  cache.put(rk, String(hits + 1), 3600);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let status = 'saved';
  try {
    const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(Z.sheet);
    const rows = sh.getRange(Z.first, 1, sh.getLastRow() - Z.first + 1, 10).getValues();
    const i = rows.findIndex((r) => String(r[1]).replace(/\.0$/, '') === apt);
    if (i < 0) return json_({ ok: false, error: 'Такої квартири немає в будинку. Перевірте номер (1–725, для 337 — 337-1 або 337-2)' });
    const row = Z.first + i, cur = rows[i];
    const same = !cur[8] || norm_(cur[8]) === norm_(contact) || !cur[4];
    const now = new Date();
    if (same) {
      sh.getRange(row, 4, 1, 3).setValues([[name || cur[3], answer, amount || '']]);
      sh.getRange(row, 9, 1, 2).setValues([[contact || cur[8], now]]);
    } else {
      status = 'review';
      sh.getRange(row, 8).setValue('⚠ Ще одна заявка з іншим контактом (' + Utilities.formatDate(now, 'Europe/Kyiv', 'dd.MM HH:mm') + '), див. «Заявки»');
    }
    log_(ss).appendRow([now, apt, answer, amount || '', name, contact, same ? 'внесено' : '⚠ на перевірку']);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  cache.remove('stats');
  return json_({ ok: true, status: status, stats: stats_(false) });
}

/** Лише агрегати. Медіана — по тих, хто відповів «Так» і вказав суму. */
function stats_(useCache) {
  const cache = CacheService.getScriptCache();
  if (useCache) { const c = cache.get('stats'); if (c) return JSON.parse(c); }
  const sh = SpreadsheetApp.getActive().getSheetByName(Z.sheet);
  const rows = sh.getRange(Z.first, 1, sh.getLastRow() - Z.first + 1, 7).getValues();
  const sections = Z.sections.map(() => ({ total: 0, yes: 0, maybe: 0, no: 0, pledged: 0 }));
  const amounts = [];
  let paid = 0;
  rows.forEach((r) => {
    const n = parseInt(String(r[1]), 10);
    if (!n) return;
    let s = 0;
    Z.sections.forEach((f, k) => { if (n >= f) s = k; });
    const x = sections[s], amt = Number(r[5]) || 0;
    x.total++;
    if (r[4] === 'Так') { x.yes++; x.pledged += amt; if (amt > 0) amounts.push(amt); }
    else if (r[4] === 'Подумаю') x.maybe++;
    else if (r[4] === 'Ні') x.no++;
    paid += Number(r[6]) || 0;
  });
  amounts.sort((a, b) => a - b);
  const m = amounts.length, median = m ? (m % 2 ? amounts[(m - 1) / 2] : (amounts[m / 2 - 1] + amounts[m / 2]) / 2) : 0;
  const out = { updatedAt: Utilities.formatDate(new Date(), 'Europe/Kyiv', "yyyy-MM-dd'T'HH:mm"), median: Math.round(median), paid, sections };
  cache.put('stats', JSON.stringify(out), 300);
  return out;
}

/** Запусти один раз: створить аркуш «Заявки». */
function setup() { log_(SpreadsheetApp.getActive()); }

function log_(ss) {
  let log = ss.getSheetByName(Z.log);
  if (!log) {
    log = ss.insertSheet(Z.log);
    log.appendRow(['Коли', '№ кв.', 'Готовність', 'Сума, грн', 'Ім’я', 'Контакт', 'Результат']);
    log.getRange(1, 1, 1, 7).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

function norm_(s) { return String(s).toLowerCase().replace(/[^\da-zа-яіїєґ_]/g, '').replace(/^380/, '0'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
