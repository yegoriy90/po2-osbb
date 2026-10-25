/**
 * Сторінка підтвердження власників для реєстру ОСББ (Google Apps Script Web App).
 *
 *  • Сторінка (Page.html) — лише для власника таблиці: фото документів → Claude розпізнає →
 *    форма з даними й попередженнями → «Підтвердити» → запис у реєстр, лог «Заявки», фото на Drive.
 *  • Під таблицю registry_v10 (Google-таблиця): «в ДАХ» — колонка G реєстру і E нежитлових, значеннями.
 *  • ?stats=1 — публічний JSON для po2.kyiv.ua: лише суми по секціях (без номерів і ПІБ),
 *    у форматі window.VOTES з votes.js.
 *
 * Розгортання й налаштування — tools/apps-script/README.md. Розпізнавання: безкоштовний OCR Google Drive
 * (служба «Drive API») або Claude, якщо в Script properties є ANTHROPIC_API_KEY.
 */

const CFG = {
  model: 'claude-opus-5-5',
  apiVersion: '2026-10-21',
  base: 50258.3,                 // база ОСББ, м² (квартири + нежитлові)
  sections: [1, 211, 367, 477],  // перші квартири секцій (як у data.js)
  apts: 'Реєстр мешканців',      // A №, B площа, C власник, D телефон, E Telegram, F статус, G ДАХ («✅ У ДАХ»/«❌ Не в ДАХ»); дані з 4-го рядка
  nonres: 'Нежитлові приміщення', // A №, B площа, C власник, D категорія, E ДАХ; дані з 3-го рядка
  log: 'Заявки',
  folder: 'ДАХ документи',
};
const OWNER = 'Право власності', IN_DAH = '✅ У ДАХ';

// ---------------------------------------------------------------- вхід

function doGet(e) {
  if (e && e.parameter && e.parameter.stats) {
    return ContentService.createTextOutput(JSON.stringify(stats_(true))).setMimeType(ContentService.MimeType.JSON);
  }
  if (!isOwner_()) return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">Доступ лише для ініціативної групи.</p>');
  return HtmlService.createHtmlOutputFromFile('Page').setTitle('Підтвердження власників · ПО2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Сторінкою й діями може користуватись лише власник скрипта (навіть якщо URL потрапить до когось). */
function isOwner_() {
  const me = Session.getActiveUser().getEmail();
  return !!me && me === Session.getEffectiveUser().getEmail();
}
function guard_() { if (!isOwner_()) throw new Error('Немає доступу'); }

// ---------------------------------------------------------------- налаштування

/** Запусти один раз: створить аркуш-лог «Заявки». */
function setup() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(CFG.log)) {
    const log = ss.insertSheet(CFG.log);
    log.appendRow(['Коли', 'Тип', '№', 'Площа', 'ПІБ', 'Телефон', 'Документи', 'Право', 'Дата реєстрації', 'Попередження', 'Фото']);
    log.getRange(1, 1, 1, 11).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  if (typeof Drive === 'undefined' && !PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) {
    SpreadsheetApp.getUi().alert('Для безкоштовного розпізнавання увімкни службу «Drive API» (Служби → ＋) або додай ANTHROPIC_API_KEY у властивості скрипту.');
  }
}

// ---------------------------------------------------------------- розпізнавання

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['object_type', 'number', 'area_total', 'owners', 'right_type', 'documents', 'address', 'address_matches', 'registration_date', 'phone', 'problems'],
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
    phone: { type: 'string', description: 'Телефон власника, якщо є на фото (напр. скрін картки в ДАХ), у форматі +380XXXXXXXXX; "" якщо нема' },
    problems: { type: 'array', items: { type: 'string' }, description: 'Що не видно, не збігається між документами або викликає сумнів. Коротко, українською.' },
  },
};

const PROMPT = 'Це фото документів власника приміщення в ЖК на вул. Воскресенська, 2-В, м. Київ. ' +
  'Витягни дані для реєстру співвласників ОСББ. Голос рахується лише для права власності ' +
  '(витяг з реєстру речових прав, ДКП, свідоцтво); інвестиційний чи попередній договір — не право власності. ' +
  'Договір з УК може підтверджувати ПІБ, якщо в ньому вказано підставу (ДКП). ' +
  'Нічого не вигадуй: що не видно чітко — залиш порожнім і опиши в problems. ' +
  'Якщо документи суперечать один одному (номер, площа, ПІБ) — теж напиши в problems.';

/**
 * Викликається зі сторінки. images: [{type: 'image/jpeg', data: base64}] (вже стиснені в браузері).
 * Повертає розпізнані дані + що зараз у реєстрі + попередження.
 */
function analyze(images) {
  guard_();
  if (!images || !images.length) throw new Error('Немає фото');
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  // Є ключ Claude — розпізнає Claude; немає — безкоштовний OCR Google Drive + розбір за шаблоном
  const d = key ? claude_(images.slice(0, 6)) : ocrParse_(images.slice(0, 6));
  d.engine = key ? 'claude' : 'ocr';
  return Object.assign(d, check_(d));
}

// ---------------------------------------------------------------- безкоштовний режим: OCR Google Drive

/** Фото/PDF → текст через OCR Google Drive (потрібна служба «Drive API» у редакторі Apps Script). */
function ocr_(im) {
  const blob = Utilities.newBlob(Utilities.base64Decode(im.data), im.type, 'ocr');
  const file = Drive.Files.create({ name: 'ocr-tmp', mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'uk' });
  try {
    return DocumentApp.openById(file.id).getBody().getText();
  } finally {
    DriveApp.getFileById(file.id).setTrashed(true);
  }
}

function ocrParse_(images) {
  if (typeof Drive === 'undefined') throw new Error('Увімкни службу «Drive API» у редакторі Apps Script (Служби → ＋)');
  const d = parseDocText_(images.map(ocr_).join('\n\n'));
  d.problems.push('Розпізнано безкоштовним OCR без ШІ — звір поля з фото');
  return d;
}

/** Розбір тексту витягу / ДКП / договору з УК у формат SCHEMA. Лише шаблони, без ШІ. */
function parseDocText_(raw) {
  const t = raw.replace(/[ \t\u00a0]+/g, ' ').replace(/[’ʼ`]/g, "'");
  const most = (arr) => { const c = {}; arr.forEach((x) => (c[x] = (c[x] || 0) + 1)); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ''; };
  const all = (re) => { const out = []; let m; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = g.exec(t))) out.push(m); return out; };

  // Номер: лише в межах рядка (інакше «Тип об'єкта: квартира» + цифри з наступного рядка дають хибний номер).
  // OCR часто читає «№» як «Ne», «No», «N°». Сильний контекст — після адреси «2-В, квартира N» чи «власником квартири № N».
  const NUM = "[ \\t]*(?:№|N[eoо°º]?\\.?)?[ \\t]*(\\d{1,3}(?:-\\d)?)(?!\\d|[.,]\\d|/)";
  const score = {};
  const add = (re, w, ok) => all(new RegExp(re, 'i')).forEach((m) => { if (!ok || ok(m[1])) score[m[1]] = (score[m[1]] || 0) + w; });
  const okFlat = (n) => (+n.split('-')[0] >= 1 && +n.split('-')[0] <= 725);
  add("2[ \\t]*[-–]?[ \\t]*[ВB][ \\t,]+(?:квартира|кв\\.)" + NUM, 5, okFlat);
  add("власник\\S*[ \\t]+квартири" + NUM, 5, okFlat);
  add("2[ \\t]*[-–]?[ \\t]*[ВB][ \\t]*,[ \\t]*(\\d{1,3}(?:-\\d)?)(?!\\d|[.,]\\d|/)", 3, okFlat); // ДАХ: «Воскресенська 2В, 165»
  add("(?<!об'єкта:[ \\t]?)квартир[аиіу]" + NUM, 2, okFlat);
  add("(?:^|[ \\t,(])кв\\." + NUM, 2, okFlat);
  if (/управління\s+багатоквартирним/i.test(t)) add("договір" + NUM, 1, okFlat); // у договорах з УК № = № квартири
  const flat = Object.keys(score).sort((a, b) => score[b] - score[a]);
  const nonres = all(/нежитлов\S*[ \t]+приміщенн\S*[ \t]*(?:№|N[eoо°º]?\.?)?[ \t]*(\d{1,4})(?!\d)/i).map((m) => m[1]);
  const object_type = flat.length ? 'квартира' : nonres.length ? 'нежитлове' : 'невідомо';
  const number = flat.length ? flat[0] : most(nonres);

  const areaM = t.match(/[Зз]агальна\s+площа\s*\(?\s*кв\.?\s*м\.?\s*\)?\s*:?\s*(\d{1,4}(?:[.,]\d{1,2})?)/) ||
    t.match(/(?:загальною\s+)?площею\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*кв/i);
  const area_total = areaM ? areaM[1].replace(',', '.') : '';

  const documents = [];
  if (/витяг/i.test(t)) documents.push('витяг з реєстру речових прав');
  if (/купівлі[-\s]*продажу/i.test(t)) documents.push('договір купівлі-продажу');
  if (/свідоцтв\S*\s+про\s+право\s+власності/i.test(t)) documents.push('свідоцтво про право власності');
  if (/управління\s+багатоквартирним/i.test(t)) documents.push('договір з УК');
  if (/інвестиц|попередн\S*\s+договір/i.test(t)) documents.push('інвестиційний/попередній договір');
  if (!documents.length) documents.push('інше');

  const owns = /Тип\s+речового\s+права\s*:?\s*право\s+власності/i.test(t) || /свідоцтв\S*\s+про\s+право\s+власності/i.test(t) ||
    /купівлі[-\s]*продажу/i.test(t) || /є\s+власником/i.test(t);
  const right_type = owns ? 'право власності' : /інвестиц|попередн/i.test(t) ? 'інвестиційний договір' : 'невідомо';

  // ПІБ: три слова з великої, по батькові на -вич/-вна; без нотаріусів, реєстраторів і представників УК
  const W = "[А-ЯІЇЄҐ][а-яіїєґ'-]+";
  // \b у JS не бачить кирилиці — кінець слова перевіряємо явно
  const fio = new RegExp(W + '\\s+' + W + '\\s+' + "[А-ЯІЇЄҐ][а-яіїєґ'-]+(?:вич|вна|ич|на)(?![а-яіїєґ'-])", 'g');
  const owners = [];
  let m;
  while ((m = fio.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 80), m.index).toLowerCase();
    if (/нотаріус|реєстратор|представник|в особі|директор|довіреніст/.test(before)) continue;
    const ctx = /власник|суб'єкт|та\s*$|покупець/.test(before);
    if (!owners.some((o) => o.name === m[0])) owners.push({ name: m[0], share: '', source: ctx ? 'біля «власник/суб\'єкт»' : 'текст документа', ctx });
  }
  owners.sort((a, b) => b.ctx - a.ctx);
  const ownersOut = owners.slice(0, 2).map(({ name, share, source }) => ({ name, share, source }));

  const addrM = t.match(/Воскресенськ\S*[\s,]+(?:буд\S*\s*)?(?:№\s*)?2\s*[-–]?\s*([ВвBbАаAa])(?![а-яіїєґa-z])/) ||
    t.match(/буд\S*\s*(?:№\s*)?2\s*[-–]?\s*([ВвBbАаAa])(?![а-яіїєґa-z])[^\n]{0,30}?Воскресенськ/); // «буд. № 2-В по вул. Воскресенській»
  const address = addrM ? addrM[0] : '';
  const address_matches = !!addrM && /[ВвBb]/.test(addrM[1]);

  const dateM = t.match(/державної\s+реєстрації\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i) || t.match(/продажу[^.\n]{0,40}?від\s*(\d{2}\.\d{2}\.\d{4})/i) ||
    t.match(/(\d{2}\.\d{2}\.\d{4})/);
  const registration_date = dateM ? dateM[1] : '';

  // Телефон (скрін картки власника в ДАХ): +380 99 644 08 07, 099-644-08-07, (099) 6440807
  const telM = t.match(/(?<![\d\/])(?:\+?\s*3\s*8\s*)?\(?\s*0\s*\d{2}\s*\)?[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/);
  const phone = telM ? '+38' + telM[0].replace(/\D/g, '').replace(/^3?8?/, '') : '';

  const problems = [];
  if (!number) problems.push('Не знайшов номер приміщення');
  if (flat.length > 1) problems.push('У тексті різні номери: ' + flat.slice(0, 4).join(', ') + ' — взяв ' + number + ', звір із фото');
  if (!area_total) problems.push('Не знайшов площу');
  if (!ownersOut.length) problems.push('Не знайшов ПІБ власника');
  if (!addrM) problems.push('Не знайшов адресу');
  if (ownersOut.length > 1) problems.push('Кілька ПІБ у тексті — перевір, хто власник');
  return { object_type, number, area_total, owners: ownersOut, right_type, documents, address, address_matches, registration_date, phone, problems };
}

function claude_(images, schema, prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Немає ANTHROPIC_API_KEY у властивостях скрипту');
  const content = images.map((im) => (im.type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } }
    : { type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }));
  content.push({ type: 'text', text: prompt || PROMPT });
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': CFG.apiVersion, 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify({
      model: CFG.model,
      max_tokens: 4000,
      fallbacks: 'default', // якщо фільтри безпеки відхилять запит — сервер повторить на іншій моделі
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema || SCHEMA } },
      messages: [{ role: 'user', content }],
    }),
  });
  const code = res.getResponseCode(), body = JSON.parse(res.getContentText());
  if (code === 429 || code >= 500) throw new Error('Сервіс розпізнавання перевантажений — спробуй за хвилину');
  if (code !== 200) throw new Error('Помилка API ' + code + ': ' + (body.error && body.error.message));
  if (body.stop_reason === 'refusal') throw new Error('Модель відмовилась обробляти документ');
  if (body.stop_reason === 'max_tokens') throw new Error('Відповідь обрізана — спробуй менше фото');
  return JSON.parse(body.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// ---------------------------------------------------------------- заявка з ДАХ (скрін)

const DAH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'name', 'role', 'phone', 'entrance'],
  properties: {
    number: { type: 'string', description: 'Номер квартири із заявки, напр. "165"; "" якщо не видно' },
    name: { type: 'string', description: 'Ім\'я заявника як у ДАХ (може бути скорочене, напр. "К Андрій")' },
    role: { type: 'string', enum: ['власник', 'користувач', 'орендар', 'невідомо'], description: 'Статус у ДАХ: власник/співвласник, користувач/мешканець, орендар/винаймач' },
    phone: { type: 'string', description: 'Телефон +380XXXXXXXXX; "" якщо не видно' },
    entrance: { type: 'string', description: 'Номер під\'їзду, якщо вказано; "" якщо ні' },
  },
};
const DAH_PROMPT = 'Це скріни заявки з застосунку ДАХ (ЖК на вул. Воскресенська, 2-В, Київ). ' +
  'Витягни номер квартири, ім\'я заявника як написано, його статус (власник / користувач / орендар) і телефон. Нічого не вигадуй.';

/** Розбір тексту скріна ДАХ: № квартири, ім'я, статус, телефон. */
function parseDahText_(raw) {
  const t = raw.replace(/[ \t ]+/g, ' ').replace(/[’ʼ`]/g, "'");
  const d = parseDocText_(raw);
  const roleOf = (s) => (/власни/i.test(s) ? 'власник' : /орендар|наймач/i.test(s) ? 'орендар' : /користувач|мешканець/i.test(s) ? 'користувач' : '');
  // спершу окремий рядок-статус («Власник», «Статус: Орендар»), потім будь-де в тексті
  const roleLine = t.split('\n').map((x) => x.trim()).find((x) => /^(?:роль|статус)?\s*:?\s*(?:спів)?(?:власни|користувач|мешканець|орендар|винаймач|наймач)\S*$/i.test(x));
  const role = roleOf(roleLine || '') || roleOf(t) || 'невідомо';
  // Ім'я: повний ПІБ, якщо є; інакше рядок «К Андрій» / «Коваленко Андрій» (без назв кнопок і адрес)
  // Ім'я: повний ПІБ, якщо є; інакше 2–3 слова з великої («Коваленко Андрій», «К Андрій») — найближчі перед телефоном
  // (у ДАХ ім'я стоїть над номером; OCR може злити їх в один рядок). Назви кнопок і полів відкидаємо.
  let name = d.owners.length ? d.owners[0].name : '';
  if (!name) {
    const STOP = /^(?:Заявка|Власник|Співвласник|Користувач|Орендар|Під'?їзд|Квартира|Контакти|Нерухомість|Транспорт|Основний|Написати|Воскресенськ|Паркові|Озера|Київ|ДАХ|ОСББ)/;
    const tel = d.phone ? t.search(/\+?\s*3\s*8\s*\(?\s*0/) : -1;
    const re = /(?<![А-Яа-яІіЇїЄєҐґ'-])[А-ЯІЇЄҐ][а-яіїєґ'-]*\.?(?:[ \t]+[А-ЯІЇЄҐ][а-яіїєґ'-]+){1,2}(?![а-яіїєґ'-])/g;
    const cands = [];
    let m;
    while ((m = re.exec(t))) if (!m[0].split(/\s+/).some((w) => STOP.test(w))) cands.push(m);
    const before = cands.filter((c) => tel >= 0 && c.index < tel);
    name = (before.length ? before[before.length - 1] : cands[0] || [''])[0];
  }
  const entM = t.match(/під'?\s*[ії]зд\S*\s*(?:№\s*)?(\d)(?!\d)/i);
  return { number: d.object_type === 'квартира' ? d.number : '', name, role, phone: d.phone, entrance: entM ? entM[1] : '' };
}

/** Чи збігається ім'я з ДАХ («К Андрій») з власником у реєстрі («Коваленко Андрій Петрович»). */
function nameMatch_(dahName, regOwner) {
  const tok = (s) => String(s).toLowerCase().replace(/[’ʼ`]/g, "'").replace(/[.,;()]/g, ' ').split(/\s+/).filter(Boolean);
  const reg = tok(regOwner), dah = tok(dahName);
  if (!reg.length) return 'нема ПІБ';
  if (!dah.length) return 'ні';
  const hit = dah.filter((w) => reg.some((r) => (w.length === 1 ? r[0] === w : r === w)));
  return hit.length === dah.length ? 'так' : hit.some((w) => w.length > 1) ? 'частково' : 'ні';
}

/** Перевірка заявки: що в реєстрі, чи збігається власник, що робити і текст відповіді в ДАХ. */
function dahCheck(d) {
  guard_();
  const r = d.number ? regRow_('квартира', d.number) : null;
  const current = r ? { status: r.status, area: r.area, owner: r.owner, phone: r.phone, dah: r.dah } : null;
  const match = r ? nameMatch_(d.name, r.owner) : 'нема в реєстрі';
  // у ДАХ ім'я записане як «Прізвище Ім'я» («К Андрій»): звертаємось на ім'я — друге слово; одне слово — без імені
  const words = String(d.name || '').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  const first = words.length >= 2 && words[1].length > 1 ? words[1] : '';
  const hi = 'Вітаємо' + (first ? ', ' + first : '') + '! Дякуємо, що долучилися до ДАХ 🙌 ';
  const proof = 'надішліть, будь ласка, фото витягу з Державного реєстру речових прав або договору купівлі-продажу ' +
    '(сторінку з ПІБ, адресою і площею).';
  const warnings = [];
  let verdict, message;
  if (!d.number) warnings.push('❗ Не видно номера квартири — впиши вручну');
  const sec = d.number ? CFG.sections.filter((f) => parseInt(d.number, 10) >= f).length : 0;
  if (d.entrance && sec && +d.entrance !== sec) warnings.push('❗ У ДАХ під\'їзд ' + d.entrance + ', а кв. ' + d.number + ' — секція ' + sec + ': перевір номер');
  else if (!r) warnings.push('❗ Кв. ' + d.number + ' немає в реєстрі');
  if (d.role !== 'власник') {
    verdict = 'not-owner';
    warnings.unshift('❗ У ДАХ статус «' + d.role + '» — голос не рахується');
    message = hi + 'За нашим реєстром ви не зазначені як власник кв. ' + d.number + ', а для створення ОСББ голосують лише власники. ' +
      'Будь ласка, попросіть власника квартири теж додатися в ДАХ і підтвердити право власності. Якщо власник — саме ви, ' + proof;
  } else if (match === 'так' && r.status === OWNER) {
    verdict = 'ok';
    message = 'Дякуємо' + (first ? ', ' + first : '') + '! Ваш голос за створення ОСББ зараховано ✅ Слідкувати за прогресом: po2.kyiv.ua';
  } else {
    verdict = match === 'так' ? 'confirm' : 'proof';
    if (match === 'так') warnings.push('Статус у реєстрі: «' + (r.status || '—') + '». Внести можна, але краще попросити витяг (повідомлення нижче)');
    else if (match === 'частково') warnings.push('ПІБ збігається лише частково: у реєстрі «' + r.owner + '»');
    else if (r && match === 'нема ПІБ') warnings.push('У реєстрі немає ПІБ власника кв. ' + d.number);
    else if (r) warnings.push('❗ У реєстрі інший власник: «' + r.owner + '» (можливо, продаж)');
    message = hi + 'Щоб ваш голос за створення ОСББ зарахувався, підтвердьте право власності на кв. ' + d.number + ': ' + proof +
      ' Без підтвердження у вас буде статус звичайного користувача.';
  }
  if (r && r.dah === IN_DAH && r.status === OWNER) warnings.push('Вже зараховано раніше');
  return { current, match, verdict, message, warnings };
}

/** Скріни заявки з ДАХ → № , ім'я, статус, телефон + перевірка за реєстром. */
function analyzeDah(images) {
  guard_();
  if (!images || !images.length) throw new Error('Немає скрінів');
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key && typeof Drive === 'undefined') throw new Error('Увімкни службу «Drive API» у редакторі Apps Script (Служби → ＋)');
  const d = key ? claude_(images.slice(0, 6), DAH_SCHEMA, DAH_PROMPT) : parseDahText_(images.slice(0, 6).map(ocr_).join('\n\n'));
  return Object.assign(d, dahCheck(d));
}

// ---------------------------------------------------------------- реєстр

function regRow_(type, number) {
  const nonres = type === 'нежитлове';
  const sh = SpreadsheetApp.getActive().getSheetByName(nonres ? CFG.nonres : CFG.apts);
  const first = nonres ? 3 : 4;
  const vals = sh.getRange(first, 1, sh.getLastRow() - first + 1, 7).getValues();
  const i = vals.findIndex((r) => String(r[0]).replace(/\.0$/, '') === String(number).trim());
  if (i < 0) return null;
  const r = vals[i];
  return { sheet: sh, row: first + i, nonres, area: r[1], owner: String(r[2] || ''), phone: String(r[3] || ''),
    status: nonres ? r[3] : r[5], dah: nonres ? r[4] : r[6] };
}

/** Попередження: що перевірити перед підтвердженням. */
function check_(d) {
  const warn = d.problems.slice();
  const area = parseFloat(String(d.area_total).replace(',', '.'));
  if (d.right_type !== 'право власності') warn.unshift('❗ Не право власності: ' + d.right_type);
  if (!d.address_matches) warn.unshift('❗ Адреса не Воскресенська, 2-В: ' + d.address);
  if (!d.number) warn.unshift('❗ Не видно номера приміщення');
  if (!d.owners.length) warn.push('Не видно ПІБ власника');
  let current = null;
  if (d.number && (d.object_type === 'квартира' || d.object_type === 'нежитлове')) {
    const r = regRow_(d.object_type, d.number);
    if (!r) warn.unshift('❗ № ' + d.number + ' немає в реєстрі');
    else {
      current = { status: r.status, area: r.area, owner: r.owner, phone: r.phone, dah: r.dah };
      if (r.area && area && Math.abs(Number(r.area) - area) > 0.5) warn.push('Площа в реєстрі інша: ' + r.area);
      const surname = (d.owners[0] && d.owners[0].name.split(' ')[0]) || '';
      if (r.owner && surname && r.owner.indexOf(surname) < 0) warn.push('У реєстрі інший власник (можливо, продаж)');
      if (r.status === OWNER) warn.push('Вже підтверджено раніше');
    }
  }
  return { warnings: warn, current };
}

/**
 * Підтвердження зі сторінки. f: {type, number, area, owner, phone, documents, right, date, warnings, images}
 * Пише в реєстр, ставить «ДАХ вручну», зберігає фото й рядок у «Заявки». Повертає новий підсумок.
 */
function approve(f) {
  guard_();
  if (f.right !== 'право власності') throw new Error('Не право власності — не вношу');
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const r = regRow_(f.type, f.number);
    if (!r) throw new Error('№ ' + f.number + ' немає в реєстрі — додай рядок вручну');
    const set = (col, v) => r.sheet.getRange(r.row, col).setValue(v);
    if (f.area) set(2, Number(String(f.area).replace(',', '.')));
    if (f.owner) set(3, f.owner);
    if (r.nonres) { set(4, OWNER); set(5, IN_DAH); } else {
      if (f.phone) set(4, f.phone);
      set(6, OWNER);
      set(7, IN_DAH);
      r.sheet.getRange(r.row, 1, 1, 9).setBackground('#C6EFCE'); // як автофарбування «Право власності»
    }
    const link = savePhotos_(f.type + ' ' + f.number, f.images || []);
    SpreadsheetApp.getActive().getSheetByName(CFG.log).appendRow([new Date(), f.type, f.number, f.area, f.owner, f.phone || '',
      (f.documents || []).join(', '), f.right, f.date, (f.warnings || []).join('\n'), link]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('stats');
  return stats_(false);
}

function savePhotos_(name, images) {
  if (!images.length) return '';
  const it = DriveApp.getFoldersByName(CFG.folder);
  const root = it.hasNext() ? it.next() : DriveApp.createFolder(CFG.folder);
  const dir = root.createFolder(name + ' · ' + Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd HH:mm'));
  images.forEach((im, i) => dir.createFile(Utilities.newBlob(Utilities.base64Decode(im.data), im.type, name + '-' + (i + 1) + (im.type === 'application/pdf' ? '.pdf' : '.jpg'))));
  return dir.getUrl();
}

// ---------------------------------------------------------------- підсумок

/** Голос = «✅ У ДАХ» + «Право власності». Формат як window.VOTES у votes.js — лише суми. */
function stats_(useCache) {
  const cache = CacheService.getScriptCache();
  if (useCache) { const c = cache.get('stats'); if (c) return JSON.parse(c); }
  const ss = SpreadsheetApp.getActive();
  const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
  const sections = CFG.sections.map(() => ({ total: 0, inDah: 0 }));
  let area = 0, nonres = 0;
  const a = ss.getSheetByName(CFG.apts), av = a.getRange(4, 1, a.getLastRow() - 3, 7).getValues();
  av.forEach((r) => {
    const n = parseInt(String(r[0]), 10);
    if (!n) return;
    let s = 0;
    CFG.sections.forEach((f, i) => { if (n >= f) s = i; });
    sections[s].total++;
    if (r[5] === OWNER && r[6] === IN_DAH) { sections[s].inDah++; area += num(r[1]); }
  });
  const nr = ss.getSheetByName(CFG.nonres), nv = nr.getRange(3, 1, nr.getLastRow() - 2, 5).getValues();
  nv.forEach((r) => { if (r[0] && r[3] === OWNER && r[4] === IN_DAH) { nonres++; area += num(r[1]); } });
  const out = { updatedAt: Utilities.formatDate(new Date(), 'Europe/Kyiv', "yyyy-MM-dd'T'HH:mm"), baseArea: CFG.base,
    dahArea: Math.round(area * 10) / 10, areaEstimated: 0, nonres, sections };
  cache.put('stats', JSON.stringify(out), 300);
  return out;
}

/** Для сторінки: поточний підсумок. */
function summary() { guard_(); return stats_(false); }
