/**
 * Розпізнавання документів власників (витяг, ДКП, договір з УК) → аркуш «Заявки» → реєстр.
 *
 * Як працює:
 *  1. Фото/PDF кладеш у папку Drive «ДАХ документи — нові».
 *     Кілька фото одного власника — в одну підпапку (назва будь-яка, напр. «165»).
 *  2. Раз на 10 хв скрипт відправляє кожен комплект у Claude, отримує № приміщення, площу,
 *     ПІБ, тип права, звіряє з реєстром і додає рядок на аркуш «Заявки». Файли переносить
 *     у «ДАХ документи — оброблені».
 *  3. Ставиш ☑ «Підтвердити» — скрипт вписує площу, ПІБ і статус «Право власності» в реєстр.
 *
 * Налаштування: див. tools/apps-script/README.md. Ключ API — у Script properties
 * (ANTHROPIC_API_KEY), не в коді.
 */

const CFG = {
  model: 'claude-opus-5-5',
  apiVersion: '2026-10-21',
  inbox: 'ДАХ документи — нові',
  done: 'ДАХ документи — оброблені',
  sheet: 'Заявки',
  apts: 'Реєстр мешканців',   // A №, B площа, C власник, F статус; дані з 4-го рядка
  nonres: 'Нежитлові приміщення', // A №, B площа, C власник, D категорія; дані з 3-го рядка
  maxPerRun: 3,               // комплектів за запуск (ліміт часу Apps Script — 6 хв)
  maxFiles: 6,                // фото в одному комплекті
  deleteAfterApprove: false,  // true — фото йдуть у кошик після підтвердження
};

const COLS = ['Отримано', 'Тип', '№', 'Площа', 'ПІБ власника', 'Документи', 'Право', 'Дата реєстрації',
  'Адреса ок', 'У реєстрі зараз', '⚠ Перевірити', 'Фото', 'Підтвердити', 'Внесено', 'id'];
const C = Object.fromEntries(COLS.map((h, i) => [h, i + 1]));

// ---------------------------------------------------------------- налаштування

/** Запусти один раз вручну: створить папки, аркуш «Заявки» і тригери. */
function setup() {
  folder_(CFG.inbox);
  folder_(CFG.done);
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.sheet);
  if (!sh) {
    sh = ss.insertSheet(CFG.sheet, 1);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#2E4D23').setFontColor('#fff');
    sh.setFrozenRows(1);
    sh.hideColumns(C['id']);
    sh.setColumnWidth(C['ПІБ власника'], 230);
    sh.setColumnWidth(C['⚠ Перевірити'], 320);
  }
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onApprove').forSpreadsheet(ss).onEdit().create();
  if (!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) {
    SpreadsheetApp.getUi().alert('Додай ANTHROPIC_API_KEY: Налаштування проєкту → Властивості скрипту.');
  }
}

function folder_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

// ---------------------------------------------------------------- обробка вхідних

function processInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // попередній запуск ще працює
  try {
    const inbox = folder_(CFG.inbox), done = folder_(CFG.done);
    const batches = [];
    const subs = inbox.getFolders();
    while (subs.hasNext()) { const f = subs.next(); batches.push({ name: f.getName(), item: f, files: list_(f.getFiles()) }); }
    const loose = inbox.getFiles();
    while (loose.hasNext()) { const f = loose.next(); batches.push({ name: f.getName(), item: f, files: [f] }); }

    for (const b of batches.slice(0, CFG.maxPerRun)) {
      if (!b.files.length) continue;
      let row;
      try {
        row = toRow_(b, extract_(b.files.slice(0, CFG.maxFiles)));
      } catch (e) {
        if (String(e).includes('RETRY')) continue; // напр. Drive ще не зробив прев'ю фото
        row = errorRow_(b, e);
      }
      SpreadsheetApp.getActive().getSheetByName(CFG.sheet).appendRow(row);
      const sh = SpreadsheetApp.getActive().getSheetByName(CFG.sheet);
      sh.getRange(sh.getLastRow(), C['Підтвердити']).insertCheckboxes();
      b.item.moveTo(done);
    }
  } finally {
    lock.releaseLock();
  }
}

function list_(it) { const a = []; while (it.hasNext()) a.push(it.next()); return a; }

/** Файл Drive → блок для Claude. Великі фото й HEIC (iPhone) беремо через JPEG-прев'ю Drive. */
function block_(file) {
  const mime = file.getMimeType();
  if (mime === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(file.getBlob().getBytes()) } };
  }
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  let blob = file.getBlob();
  if (!ok.includes(mime) || file.getSize() > 3.5e6) {
    const auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    const meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() + '?fields=thumbnailLink', { headers: auth }).getContentText());
    if (!meta.thumbnailLink) throw new Error('RETRY'); // прев'ю ще не готове — спробуємо наступного разу
    blob = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s2000'), { headers: auth }).getBlob();
  }
  return { type: 'image', source: { type: 'base64', media_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['object_type', 'number', 'area_total', 'owners', 'right_type', 'documents', 'address', 'address_matches', 'registration_date', 'problems'],
  properties: {
    object_type: { type: 'string', enum: ['квартира', 'нежитлове', 'паркомісце', 'невідомо'] },
    number: { type: 'string', description: 'Номер квартири/приміщення як у документі, напр. "165" або "337-1"; "" якщо не видно' },
    area_total: { type: 'string', description: 'Загальна площа, м², число з крапкою, напр. "62.0"; "" якщо не видно' },
    owners: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'share', 'source'], properties: {
        name: { type: 'string', description: 'ПІБ повністю, як у документі' },
        share: { type: 'string', description: 'Частка, напр. "1/1" або "1/2"; "" якщо не вказано' },
        source: { type: 'string', description: 'З якого документа взято ПІБ' },
      } },
    },
    right_type: { type: 'string', enum: ['право власності', 'інвестиційний договір', 'інше', 'невідомо'] },
    documents: { type: 'array', items: { type: 'string', enum: ['витяг з реєстру речових прав', 'договір купівлі-продажу', 'свідоцтво про право власності', 'договір з УК', 'інвестиційний/попередній договір', 'інше'] } },
    address: { type: 'string' },
    address_matches: { type: 'boolean', description: 'Адреса — Київ, вул. Воскресенська, 2-В (або 2В)' },
    registration_date: { type: 'string', description: 'Дата державної реєстрації права або договору, ДД.ММ.РРРР; "" якщо не видно' },
    problems: { type: 'array', items: { type: 'string' }, description: 'Що не видно, не збігається між документами або викликає сумнів. Коротко, українською.' },
  },
};

const PROMPT = 'Це фото документів власника приміщення в ЖК на вул. Воскресенська, 2-В, м. Київ. ' +
  'Витягни дані для реєстру співвласників ОСББ. Голос рахується лише для права власності ' +
  '(витяг з реєстру речових прав, ДКП, свідоцтво); інвестиційний чи попередній договір — не право власності. ' +
  'Договір з УК може підтверджувати ПІБ, якщо в ньому вказано підставу (ДКП). ' +
  'Нічого не вигадуй: що не видно чітко — залиш порожнім і опиши в problems. ' +
  'Якщо документи суперечать один одному (номер, площа, ПІБ) — теж напиши в problems.';

function extract_(files) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Немає ANTHROPIC_API_KEY у властивостях скрипту');
  const content = files.map(block_).concat([{ type: 'text', text: PROMPT }]);
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': CFG.apiVersion,
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: CFG.model,
      max_tokens: 4000,
      fallbacks: 'default', // якщо фільтри безпеки відхилять запит — сервер повторить на іншій моделі
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    }),
  });
  const code = res.getResponseCode(), body = JSON.parse(res.getContentText());
  if (code === 429 || code >= 500) throw new Error('RETRY'); // перевантаження — наступний запуск
  if (code !== 200) throw new Error('API ' + code + ': ' + (body.error && body.error.message));
  if (body.stop_reason === 'refusal') throw new Error('Модель відмовилась обробляти документ');
  if (body.stop_reason === 'max_tokens') throw new Error('Відповідь обрізана (max_tokens)');
  const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

// ---------------------------------------------------------------- звірка з реєстром

function regRow_(type, number) {
  const nonres = type === 'нежитлове';
  const sh = SpreadsheetApp.getActive().getSheetByName(nonres ? CFG.nonres : CFG.apts);
  const first = nonres ? 3 : 4;
  const vals = sh.getRange(first, 1, sh.getLastRow() - first + 1, 6).getValues();
  const i = vals.findIndex((r) => String(r[0]).replace(/\.0$/, '') === String(number));
  if (i < 0) return null;
  const r = vals[i];
  return { sheet: sh, row: first + i, area: r[1], owner: String(r[2] || ''), status: nonres ? r[3] : r[5], nonres };
}

function toRow_(b, d) {
  const warn = d.problems.slice();
  const area = parseFloat(String(d.area_total).replace(',', '.'));
  const names = d.owners.map((o) => o.name + (o.share && o.share !== '1/1' ? ' (' + o.share + ')' : '')).join('; ');
  if (d.right_type !== 'право власності') warn.unshift('❗ Не право власності: ' + d.right_type);
  if (!d.address_matches) warn.unshift('❗ Адреса не Воскресенська, 2-В: ' + d.address);
  if (!d.number) warn.unshift('❗ Не видно номера приміщення');
  if (!d.owners.length) warn.push('Не видно ПІБ власника');
  let now = '—';
  if (d.number && (d.object_type === 'квартира' || d.object_type === 'нежитлове')) {
    const r = regRow_(d.object_type, d.number);
    if (!r) warn.unshift('❗ № ' + d.number + ' не знайдено в реєстрі');
    else {
      now = [r.status, r.area ? r.area + ' м²' : 'без площі', r.owner || 'без ПІБ'].join(' · ');
      if (r.area && area && Math.abs(Number(r.area) - area) > 0.5) warn.push('Площа в реєстрі інша: ' + r.area);
      const surname = (d.owners[0] && d.owners[0].name.split(' ')[0]) || '';
      if (r.owner && surname && r.owner.indexOf(surname) < 0) warn.push('У реєстрі інший власник (можливо, продаж)');
      if (r.status === 'Право власності') warn.push('Вже підтверджено раніше');
    }
  }
  const link = b.item.getUrl();
  return [new Date(), d.object_type, d.number, isNaN(area) ? '' : area, names, d.documents.join(', '), d.right_type,
    d.registration_date, d.address_matches ? '✅' : '❌', now, warn.join('\n'), link, false, '', b.item.getId()];
}

function errorRow_(b, e) {
  return [new Date(), '', '', '', '', '', '', '', '', '', '❗ Помилка: ' + e.message, b.item.getUrl(), false, '', b.item.getId()];
}

// ---------------------------------------------------------------- підтвердження

/** Тригер на редагування: ☑ «Підтвердити» → запис у реєстр. */
function onApprove(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== CFG.sheet || e.range.getColumn() !== C['Підтвердити'] || e.value !== 'TRUE') return;
  const row = e.range.getRow();
  const v = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
  const get = (h) => v[C[h] - 1];
  if (get('Внесено')) return;
  const note = (msg) => sh.getRange(row, C['Внесено']).setValue(msg);

  if (get('Право') !== 'право власності') return note('⛔ не право власності — не вношу');
  const r = regRow_(get('Тип'), String(get('№')));
  if (!r) return note('⛔ № ' + get('№') + ' немає в реєстрі — внеси вручну');
  if (get('Площа')) r.sheet.getRange(r.row, 2).setValue(Number(get('Площа')));
  if (get('ПІБ власника')) r.sheet.getRange(r.row, 3).setValue(get('ПІБ власника'));
  r.sheet.getRange(r.row, r.nonres ? 4 : 6).setValue('Право власності');
  note('✅ ' + Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM HH:mm'));

  if (CFG.deleteAfterApprove) {
    const id = get('id');
    try { DriveApp.getFolderById(id).setTrashed(true); } catch (_) { try { DriveApp.getFileById(id).setTrashed(true); } catch (__) {} }
  }
}
