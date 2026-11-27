/**
 * «Поруч» — Google Apps Script Web App у таблиці «ПО2 · Комерція (публічна)».
 *
 *  • GET ?places=1 — JSON для po2.kyiv.ua/poruch/: лише рядки «Показувати = так», лише публічні колонки аркуша «Заклади».
 *  • POST (форма «Додати заклад» на сайті) — новий рядок у «Заклади» з «Показувати = ні» (чернетка)
 *    + рядок у «Заявки» з контактом власника (контакт на сайт не потрапляє) + лист власнику таблиці.
 *    Перевіряєш, за потреби правиш, ставиш «так» — і заклад на сайті (кеш 5 хв).
 * Розгортання — tools/poruch-script/README.md.
 */

const P = {
  sheet: 'Заклади',
  log: 'Заявки',
  perHour: 10,          // заявок з форми на годину (усього), захист від спаму
  // колонка таблиці → ключ у JSON (шукаються за назвою в 1-му рядку)
  cols: { show: /показ/i, name: /назва/i, cat: /категор/i, unit: /приміщ/i, sec: /секц/i, side: /^де$/i, about: /пропонує|опис/i,
    hours: /годин/i, phone: /телеф/i, ig: /insta/i, site: /сайт/i, photo: /фото/i, noPower: /без світла/i, deal: /^акція(?! діє)/i, dealTill: /діє до/i },
};

function doGet(e) {
  if (e && e.parameter && e.parameter.places) return json_(places_(true));
  return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">Заклади ЖК — на <a href="https://po2.kyiv.ua/poruch/">po2.kyiv.ua/poruch</a>.</p>');
}

function doPost(e) {
  let f;
  try { f = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Не вдалося прочитати заявку' }); }
  if (f.website) return json_({ ok: true }); // приманка для ботів
  const s = (k, n) => String(f[k] || '').trim().slice(0, n || 200);
  const d = { name: s('name', 80), cat: s('cat', 30), unit: s('unit', 6), sec: s('sec', 2), side: s('side', 10), about: s('about', 200), hours: s('hours', 120),
    phone: s('phone', 40), ig: s('ig', 80), site: s('site', 120), noPower: f.noPower ? 'так' : 'ні', deal: s('deal', 120), dealTill: s('dealTill', 12) };
  const contact = s('contact', 80), who = s('who', 60);
  if (!d.name) return json_({ ok: false, error: 'Вкажіть назву закладу' });
  if (!d.about) return json_({ ok: false, error: 'Коротко напишіть, що пропонуєте' });
  if (!contact) return json_({ ok: false, error: 'Залиште контакт для зв’язку — його не буде на сайті' });

  const cache = CacheService.getScriptCache(), hits = Number(cache.get('rate') || 0);
  if (hits >= P.perHour) return json_({ ok: false, error: 'Забагато заявок. Спробуйте за годину.' });
  cache.put('rate', String(hits + 1), 3600);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(P.sheet);
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = head.map((h) => {
      const k = Object.keys(P.cols).find((key) => P.cols[key].test(String(h).trim()));
      return k === 'show' ? 'ні' : k ? d[k] || '' : '';
    });
    sh.appendRow(row);
    const at = sh.getLastRow();
    const unitCol = head.findIndex((h) => P.cols.unit.test(String(h).trim()));
    if (unitCol >= 0) sh.getRange(at, unitCol + 1).setNumberFormat('@').setValue(d.unit); // «2-6» не має стати датою
    sh.getRange(at, 1, 1, head.length).setBackground('#fff4d6');
    log_(ss).appendRow([new Date(), d.name, who, contact, d.cat, d.unit || (d.sec ? 'С' + d.sec + ' ' + d.side : ''), 'рядок ' + at + ' у «Заклади», Показувати = ні']);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'ПО2 · Поруч: заявка «' + d.name + '»',
      'Нова заявка з po2.kyiv.ua/poruch/\n\n' + d.name + ' (' + (d.cat || 'без категорії') + ')\n' + d.about + '\nКонтакт: ' + contact + (who ? ' · ' + who : '') +
      '\n\nУ таблиці «Заклади» — жовтий рядок з «Показувати = ні». Перевір і постав «так», щоб показати на сайті.\n' + SpreadsheetApp.getActive().getUrl());
  } catch (err) {} // без дозволу на пошту заявка все одно збережена
  return json_({ ok: true });
}

/** Лише «Показувати = так» і лише публічні колонки. */
function places_(useCache) {
  const cache = CacheService.getScriptCache();
  if (useCache) { const c = cache.get('places'); if (c) return JSON.parse(c); }
  const sh = SpreadsheetApp.getActive().getSheetByName(P.sheet);
  const vals = sh.getDataRange().getValues(), head = vals[0];
  const idx = {};
  Object.keys(P.cols).forEach((k) => (idx[k] = head.findIndex((h) => P.cols[k].test(String(h).trim()))));
  const fmt = (v) => (v instanceof Date ? Utilities.formatDate(v, 'Europe/Kyiv', 'dd.MM.yyyy') : String(v).trim());
  const places = vals.slice(1).filter((r) => idx.show >= 0 && /^(так|yes|1|true|✅)/i.test(String(r[idx.show]).trim())).map((r) => {
    const o = {};
    Object.keys(idx).forEach((k) => { if (k !== 'show' && idx[k] >= 0) o[k] = fmt(r[idx[k]]); });
    return o;
  }).filter((o) => o.name);
  const out = { updatedAt: Utilities.formatDate(new Date(), 'Europe/Kyiv', "yyyy-MM-dd'T'HH:mm"), places };
  cache.put('places', JSON.stringify(out), 300);
  return out;
}

/** Запусти один раз: створить аркуш «Заявки» і попросить дозвіл на пошту (сповіщення про заявки). */
function setup() {
  log_(SpreadsheetApp.getActive());
  MailApp.getRemainingDailyQuota();
}

/** Скинути кеш, щоб зміни в таблиці з'явились на сайті одразу (інакше — до 5 хв). */
function refresh() { CacheService.getScriptCache().remove('places'); }

function log_(ss) {
  let log = ss.getSheetByName(P.log);
  if (!log) {
    log = ss.insertSheet(P.log);
    log.appendRow(['Коли', 'Заклад', 'Хто', 'Контакт', 'Категорія', 'Приміщення', 'Результат']);
    log.getRange(1, 1, 1, 7).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
