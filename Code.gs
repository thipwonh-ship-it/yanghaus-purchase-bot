/**
 * YH Purchase — บอทเก็บเอกสารซื้อจากกลุ่มไลน์ซัพพลายเออร์ + ทะเบียนบิล + รายการตามใบกำกับ
 * ผูกกับ Google Sheet "YANG Haus บัญชีซื้อ-ขาย 2026" (เขียนเฉพาะแท็บของบอท ไม่แตะแท็บ ซื้อ/ขาย/ค่าใช้จ่าย)
 *
 * บอทรับอย่างเดียว: ไม่ reply / ไม่ push เข้ากลุ่ม  (push ได้ที่เดียวคือแชท 1:1 ของคุณอ้อย วันตัดยอดรุ่งเรือง)
 *
 * Deploy: Apps Script → Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone
 * Webhook URL ที่ใส่ใน LINE Developers = <URL ของ web app>?k=<WEBHOOK_KEY>
 *
 * Script Properties (Project Settings → Script properties) — ห้ามใส่ค่าพวกนี้ในโค้ดหรือใน repo:
 *   LINE_TOKEN    = Channel access token (long-lived) ของ Messaging API channel "YH Purchase"
 *   WEBHOOK_KEY   = ข้อความสุ่มยาว ๆ ตั้งเอง (ใช้แทนการตรวจลายเซ็น เพราะ Apps Script อ่าน header ไม่ได้)
 *   GEMINI_API_KEY= คีย์จาก https://aistudio.google.com/apikey
 *   OI_USER_ID    = LINE userId ของคุณอ้อย (ดูได้จากแท็บ บอท-ตั้งค่า หลังคุณอ้อยทักบอท 1 ครั้ง) — ไม่ใส่ = ไม่ส่งร่างสรุปทางไลน์
 */
const SHEET_ID  = '17gY8l9pkJjIXqZWRfStYwga-xasJjef97HaHfI7KIB4';   // YANG Haus บัญชีซื้อ-ขาย 2026
const FOLDER_ID = '1Pfy5Bo6vfkxWDyglsAJwDhg9rh5pajV-';              // โฟลเดอร์ ส่งบัญชี
const TZ = 'Asia/Bangkok';
const GEMINI_PREFER = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3', 'gemini-2.5-flash'];

const TAB_CFG   = 'บอท-ตั้งค่า';
const TAB_QUEUE = 'บอท-คิว';
const TAB_TEXT  = 'บอท-ข้อความ';
const TAB_BILL  = 'ทะเบียนบิลซื้อ';
const TAB_FOLLOW = 'ตามใบกำกับ';
const INBOX_NAME = '_YH-Purchase-inbox';
const SUB_VAT = 'ภาษีซื้อ';
const SUB_DOCS = 'เอกสารซื้อ';
const BATCH = 12;           // เอกสารต่อรอบ (รอบละ 5 นาที)
const MAX_TRIES = 3;

/* ซัพพลายเออร์: key → ชื่อโฟลเดอร์/ชื่อสั้น + วิธีจำจากเอกสาร */
const SUPPLIERS = {
  JSTAR: { name: 'เจสตาร์',       taxId: '0105556095450', re: /เจ\s*สตาร์|JSM|JST|J[\s-]?STAR/i },
  PRR:   { name: 'ป.รุ่งโรจน์',    taxId: '0745567002266', re: /รุ่งโรจน์/ },
  RRL:   { name: 'รุ่งเรือง',      taxId: '0125567032896', re: /รุ่งเรือง/ },
  YTL:   { name: 'ยางเทรลเลอร์',  taxId: '0135551004103', re: /เทรลเลอร์|YANGTRAILER/i },
  OTHER: { name: 'อื่นๆ',         taxId: '',              re: /$^/ }
};
const JSTAR_CUSTOMER_CODE = 'C-P124';   // รหัสลูกค้าของเราที่เจสตาร์ — เอกสารของลูกค้ารายอื่นที่หลงมาในกลุ่มจะถูกข้าม
const TEXT_KEYWORDS = /สั่ง|ตัดยอด|ยอดเดือน|ใบกำกับ|จัดส่ง|รับของ|รับแล้ว|เรียกรถ|ส่งลูกค้า|โอน/;

const BILL_HEAD = ['คีย์', 'ซัพพลายเออร์', 'วันที่บิล', 'เลขที่บิล', 'ยอด', 'มีใบส่งสินค้า', 'ลิงก์เอกสารต้นทาง',
  'จ่ายแล้ว', 'วันที่จ่าย', 'เลขใบเสร็จ/สลิป', 'เลขใบกำกับ', 'วันที่ใบกำกับ', 'ยอดใบกำกับ', 'ลิงก์ใบกำกับ',
  'ได้ตัวจริง', 'สถานะ', 'รอตรวจ', 'อัปเดตล่าสุด'];
const QUEUE_HEAD = ['เวลารับ', 'แหล่ง', 'ซัพพลายเออร์', 'ผู้ส่ง', 'ชนิดข้อความ', 'messageId', 'fileId', 'สถานะ',
  'ชนิดเอกสาร', 'ผู้ขาย', 'เลขที่', 'วันที่เอกสาร', 'อ้างอิง', 'ยอด', 'VAT', 'ผลจับคู่', 'ลิงก์', 'ลองแล้ว', 'ข้อผิดพลาด', 'รอตอบรับ (ระบบใช้ชั่วคราว)'];
const TEXT_HEAD = ['เวลา', 'แหล่ง', 'ซัพพลายเออร์', 'ผู้ส่ง', 'ข้อความ'];
const CFG_HEAD = ['id (groupId/userId)', 'ชนิด', 'ซัพพลายเออร์ (JSTAR/PRR/RRL/YTL/AUTO)', 'ชื่อ', 'เปิดใช้', 'เก็บข้อความ (all/keyword/none)', 'หมายเหตุ', 'พบครั้งแรก', 'ตอบรับในแชท (ไม่ตอบ/เฉพาะเอกสารสำคัญ/ทุกไฟล์)', 'รับแจ้งเตือน (เฉพาะแชทส่วนตัว)'];
const FOLLOW_HEAD = ['วันที่', 'ซัพพลายเออร์', 'ประเภท', 'รายละเอียด', 'ข้อความสำเร็จรูป'];

/* =====================================================================
 * ส่วนที่ 1 — ตรรกะล้วน (ไม่เรียก Google/LINE) ทดสอบได้ด้วย test/run.js
 * ===================================================================== */

/* เลขเอกสาร: ตัดช่องว่าง ตัวพิมพ์ใหญ่ และแก้ตัวอักษรที่ OCR มักอ่านผิด (TV→IV, IVO1→IV01) */
function normDocNo_(s) {
  let t = String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  t = t.replace(/^(TV|1V|LV)/, 'IV').replace(/^IVO(?=\d)/, 'IV0').replace(/^S0(?=\d{6,})/, 'SO');
  /* เลขเอกสารเจสตาร์ IV + ตัวเลขล้วน: ตัวอักษรที่หลงมาในส่วนตัวเลขคือ OCR อ่านผิด (S→5, O→0, I/L→1, B→8, Z→2) */
  if (/^IV(?!CM)[0-9SOILBZ]{6,}$/.test(t)) t = 'IV' + t.slice(2).replace(/S/g, '5').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/Z/g, '2');
  return t;
}
/* เจสตาร์: เลข IVCM… = ยางเคลม/รับคืนสินค้า ไม่ใช่การซื้อ ไม่ต้องตามใบกำกับ (Thipwon 19 พ.ย. 2026) */
function isClaim_(no) { return /^IVCM/.test(String(no || '')); }
function num_(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : 0; }
function round2_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sameAmt_(a, b) { return Math.abs(num_(a) - num_(b)) <= 1; }
function ymdToUtc_(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
function daysBetween_(a, b) { return Math.round((ymdToUtc_(b) - ymdToUtc_(a)) / 86400000); }
function lastDay_(ymd) { const m = /^(\d{4})-(\d{2})/.exec(ymd); return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate(); }
function dow_(ymd) { return new Date(ymdToUtc_(ymd)).getUTCDay(); }           // 0 = อาทิตย์, 1 = จันทร์
function ym_(ymd) { return String(ymd || '').slice(0, 7); }
function addNote_(bill, note) {
  const cur = String(bill.review || '');
  if (cur.indexOf(note) < 0) bill.review = cur ? cur + ' · ' + note : note;
}
function fmtMoney_(n) { return num_(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function dmy_(ymd) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? m[3] + '/' + m[2] : ''; }

function detectSupplier_(doc) {
  const hay = [doc.seller, doc.payee, doc.title].join(' ');
  const tax = String(doc.seller_tax_id || '').replace(/\D/g, '');
  for (const k of ['JSTAR', 'PRR', 'RRL', 'YTL']) {
    if ((tax && tax === SUPPLIERS[k].taxId) || SUPPLIERS[k].re.test(hay)) return k;
  }
  return 'OTHER';
}

/* ชนิดเอกสารที่ใช้จริง: ถ้าหัวกระดาษมีคำว่า "กำกับ" ถือเป็นใบกำกับเสมอ (เจสตาร์ใช้เลข IV ทั้งใบส่งสินค้าและใบกำกับ) */
function docKind_(doc) {
  const title = String(doc.title || '');
  if (/กำกับ|TAX\s*INVOICE/i.test(title) && num_(doc.vat) > 0) return 'tax_invoice';
  if (doc.doc_type === 'tax_invoice' && num_(doc.vat) <= 0 && /ส่งสินค้า|ส่งของ/.test(title)) return 'delivery_note';
  /* ชุดเอกสาร ป.รุ่งโรจน์: 4 ใบเลขเดียวกัน มี VAT ทุกใบ ต่างกันแค่หัว → ยึดหัวเอกสาร ไม่ให้ใบเสร็จ/ใบแจ้งหนี้ถูกนับเป็นใบกำกับ */
  if (/ใบเสร็จ/.test(title)) return 'receipt';
  if (/ส่งสินค้า|ส่งของ|แจ้งหนี้/.test(title)) return 'delivery_note';
  return String(doc.doc_type || 'other');
}
/* หัวเอกสารเขียนว่า "สำเนา" และไม่มีคำว่า "ต้นฉบับ" */
function isCopy_(doc) { const t = String(doc.title || ''); return /สำเนา/.test(t) && !/ต้นฉบับ/.test(t); }
const COPY_NOTE = 'ได้แค่สำเนาใบกำกับ รอต้นฉบับ';
function dropNote_(bill, note) {
  bill.review = String(bill.review || '').split(' · ').filter(function (x) { return x && x !== note; }).join(' · ');
}

function newBill_(key, supplier) {
  return { key: key, supplier: supplier, date: '', no: '', amount: 0, hasDN: false, srcLink: '', paid: 0, payDate: '', payRef: '',
    invNo: '', invDate: '', invAmount: 0, invLink: '', original: false, status: '', review: '', updated: '', _row: 0, _dirty: true };
}
function findBill_(bills, key) { for (const b of bills) if (b.key === key) return b; return null; }
function getBill_(bills, key, supplier) {
  let b = findBill_(bills, key);
  if (!b) { b = newBill_(key, supplier); bills.push(b); }
  b._dirty = true;
  return b;
}
function billStatus_(b) {
  if (b.review) return 'รอตรวจ';
  if (!b.invNo) return 'รอใบกำกับ';
  if (b.date && b.invDate && ym_(b.date) !== ym_(b.invDate)) return b.original ? 'ครบ (ใบกำกับข้ามเดือน)' : 'รอตัวจริง (ใบกำกับข้ามเดือน)';
  return b.original ? 'ครบ' : 'รอตัวจริง';
}
function setInvoice_(bill, doc, link) {
  const no = normDocNo_(doc.doc_no);
  if (bill.invNo && bill.invNo !== no) addNote_(bill, 'มีใบกำกับ 2 เลข (' + bill.invNo + ' / ' + no + ')');
  bill.invNo = bill.invNo || no;
  bill.invDate = bill.invDate || doc.doc_date || '';
  bill.invAmount = bill.invAmount || num_(doc.total);
  bill.invLink = bill.invLink || link || '';
  if (bill.amount && !sameAmt_(bill.amount, doc.total)) addNote_(bill, 'ยอดใบกำกับ ' + fmtMoney_(doc.total) + ' ไม่ตรงยอดบิล ' + fmtMoney_(bill.amount));
  if (!bill.amount) bill.amount = num_(doc.total);
}
function addPayment_(bill, ref, date, amount) {
  const r = String(ref || '');
  const refs = String(bill.payRef || '').split(', ').filter(String);
  if (r && refs.indexOf(r) >= 0) return false;                 // ใบเสร็จ/สลิปใบนี้นับไปแล้ว
  bill.paid = round2_(num_(bill.paid) + num_(amount));
  bill.payDate = date || bill.payDate;
  if (r) { refs.push(r); bill.payRef = refs.join(', '); }
  return true;
}

/* เลขเอกสารเจสตาร์ที่ถูกรูปแบบ: IV + 9 หลัก (สนญ.) หรือ IV + รหัสสาขา 2 หลัก + 9 หลัก */
function jstarNoOk_(no) { return /^IV(\d{2})?\d{9}$/.test(String(no || '')); }
function editDist_(a, b) {
  a = String(a); b = String(b);
  let prev = []; for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/* หาใบส่งสินค้าเจสตาร์ที่ใบกำกับนี้อ้างถึง → { bill, how, note } (bill = null คือไม่พบ ให้ผู้เรียกสร้างบิลใหม่)
 * 1) เลขอ้างอิงตรง และบิลยังไม่มีใบกำกับเลขอื่น และ (ยอดตรง หรือ ไม่มีบิลอื่นที่ยอดตรงกว่า)
 * 2) เลขใกล้เคียง (ผิดไม่เกิน 2 ตัว) + ยอดตรง + มีใบเดียว → จับคู่ ไม่ต้องตรวจ
 * 3) ยอดตรง + วันที่ห่างไม่เกิน 4 วัน + มีใบเดียว → จับคู่ แต่ขึ้นรอตรวจ */
function matchJstarBill_(bills, ref, total, date, invNo) {
  const open = bills.filter(function (b) {
    return b.supplier === 'JSTAR' && b.key.indexOf('JSTAR|INV|') !== 0 && b.status !== 'ยกเลิก' && (!b.invNo || b.invNo === invNo) && sameAmt_(b.amount, total);
  });
  const near = open.filter(function (b) { return editDist_(b.no, ref) <= 2; });
  const byDate = open.filter(function (b) { return !b.date || !date || Math.abs(daysBetween_(b.date, date)) <= 4; });
  const exact = findBill_(bills, 'JSTAR|' + ref);
  if (exact && (!exact.invNo || exact.invNo === invNo)) {
    if (!exact.amount || sameAmt_(exact.amount, total)) return { bill: exact, how: '', note: '' };
    if (byDate.length !== 1) return { bill: exact, how: '', note: '' };          // ยอดไม่ตรงและไม่มีตัวเลือกที่ดีกว่า → setInvoice_ จะขึ้นหมายเหตุยอดไม่ตรงเอง
  }
  if (near.length === 1) return { bill: near[0], how: near[0].no === ref ? '' : 'เลขใกล้เคียง', note: '' };
  if (byDate.length === 1) return { bill: byDate[0], how: 'จากยอด', note: 'จับคู่จากยอด+วันที่ (เลขอ้างอิงบนใบกำกับอ่านได้ ' + ref + ') ตรวจเลขอีกครั้ง' };
  return { bill: null, how: '', note: '' };
}

/* ใส่เอกสาร 1 ใบลงทะเบียนบิล — คืนข้อความผลจับคู่ (bills ถูกแก้ในที่) */
function applyDoc_(bills, doc, supplier, link) {
  const kind = docKind_(doc);
  const no = normDocNo_(doc.doc_no);
  const date = doc.doc_date || '';
  const total = num_(doc.total);
  const lines = Array.isArray(doc.lines) ? doc.lines : [];

  if (supplier === 'JSTAR') {
    const cc = String(doc.customer_code || '').toUpperCase().replace(/\s/g, '');
    if (cc && cc !== JSTAR_CUSTOMER_CODE) return 'ข้าม: เอกสารของลูกค้ารหัส ' + cc;
    if (kind === 'delivery_note') {
      if (!no) return 'รอตรวจ: อ่านเลขใบส่งสินค้าไม่ได้';
      if (isClaim_(no)) return 'ข้าม: ยางเคลม/รับคืน ' + no;
      const b = getBill_(bills, 'JSTAR|' + no, 'JSTAR');
      b.no = no; b.date = date || b.date; b.hasDN = true; b.srcLink = link || b.srcLink;
      if (b.amount && !sameAmt_(b.amount, total)) addNote_(b, 'ยอดใบส่งสินค้า ' + fmtMoney_(total) + ' ไม่ตรงยอดเดิม ' + fmtMoney_(b.amount));
      else b.amount = total || b.amount;
      return 'บิล ' + no;
    }
    if (kind === 'outstanding_report') {
      let n = 0;
      lines.forEach(function (l) {
        const k = normDocNo_(l.doc_no); if (!k || isClaim_(k)) return;
        const b = getBill_(bills, 'JSTAR|' + k, 'JSTAR');
        b.no = k; b.date = b.date || l.doc_date || '';
        if (!b.amount) b.amount = num_(l.amount);
        else if (!sameAmt_(b.amount, l.amount)) addNote_(b, 'ยอดในรายงานค้าง ' + fmtMoney_(l.amount) + ' ไม่ตรงยอดเดิม ' + fmtMoney_(b.amount));
        n++;
      });
      return 'รายงานบิลค้าง ' + n + ' บิล';
    }
    if (kind === 'receipt') {
      let n = 0;
      lines.forEach(function (l) {
        const k = normDocNo_(l.doc_no); if (!k || isClaim_(k)) return;
        const b = getBill_(bills, 'JSTAR|' + k, 'JSTAR');
        b.no = k; b.date = b.date || l.doc_date || '';
        if (!b.amount) b.amount = num_(l.amount);
        if (addPayment_(b, no, date, num_(l.paid) || num_(l.amount))) n++;
      });
      return 'ใบเสร็จ ' + no + ' ตัดจ่าย ' + n + ' บิล';
    }
    if (kind === 'tax_invoice') {
      const ref = normDocNo_(doc.ref_no);
      if (!ref) {
        const b = getBill_(bills, 'JSTAR|INV|' + no, 'JSTAR');
        b.no = '(ไม่อ้างบิล)'; b.date = date; setInvoice_(b, doc, link); addNote_(b, 'ใบกำกับไม่อ้างเลขใบส่งสินค้า');
        return 'รอตรวจ: ใบกำกับ ' + no + ' ไม่อ้างเลขบิล';
      }
      /* รูปถ่ายในแชทอ่านเลขผิดได้ทั้งเลขใบกำกับและเลขอ้างอิง → ไม่เชื่อเลขอย่างเดียว ใช้ยอด + วันที่ช่วยยืนยัน (ดู matchJstarBill_) */
      const m = matchJstarBill_(bills, ref, total, date, no);
      const b = m.bill || getBill_(bills, 'JSTAR|' + ref, 'JSTAR');
      b._dirty = true;
      if (!m.bill) { b.no = ref; if (!jstarNoOk_(ref)) addNote_(b, 'เลขอ้างอิง ' + ref + ' ไม่ครบหลัก อาจอ่านผิด'); }
      b.date = b.date || date;
      const twin = bills.filter(function (x) { return x !== b && x.supplier === 'JSTAR' && x.invNo === no; })[0];
      setInvoice_(b, doc, link);
      if (twin) addNote_(b, 'เลขใบกำกับ ' + no + ' ซ้ำกับบิล ' + twin.no + ' อาจอ่านเลขผิด');
      if (!jstarNoOk_(no)) addNote_(b, 'เลขใบกำกับ ' + no + ' ไม่ครบหลัก อาจอ่านผิด');
      if (m.note) addNote_(b, m.note);
      /* ใบกำกับลงวันที่ก่อนวันส่งของ = ปกติเป็นไปไม่ได้ → น่าจะอ่านวันที่ผิด (เคสจริง 19 พ.ย.: 18 อ่านเป็น 15) */
      if (b.date && date && daysBetween_(b.date, date) < 0) addNote_(b, 'วันที่ใบกำกับ ' + dmy_(date) + ' ก่อนวันที่บิล ' + dmy_(b.date) + ' อาจอ่านวันที่ผิด');
      return (m.bill ? 'จับคู่บิล ' + b.no + (m.how ? ' (' + m.how + ')' : '') : 'ใบกำกับมาก่อนบิล ' + ref);
    }
    return 'เก็บไฟล์ (' + kind + ')';
  }

  if (supplier === 'PRR') {
    if (kind === 'quotation') {
      if (!no) return 'รอตรวจ: อ่านเลขใบเสนอราคาไม่ได้';
      const b = getBill_(bills, 'PRR|' + no, 'PRR');
      b.no = no; b.date = date || b.date; b.amount = total || b.amount; b.srcLink = link || b.srcLink;
      return 'บิล ' + no;
    }
    if (kind === 'transfer_slip') {
      const open = bills.filter(function (b) { return b.supplier === 'PRR' && !num_(b.paid) && sameAmt_(b.amount, total); });
      open.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      const b = open[0] || getBill_(bills, 'PRR|SLIP|' + (no || date + '|' + total), 'PRR');
      b._dirty = true;
      if (!open[0]) { b.no = '(ไม่มีใบเสนอราคา)'; b.date = date; b.amount = total; }
      addPayment_(b, no || 'slip', date, total);
      return 'จ่าย ' + fmtMoney_(total) + ' → ' + b.no;
    }
    if (kind === 'tax_invoice') {
      const dup = bills.filter(function (b) { return b.supplier === 'PRR' && b.invNo === no; })[0];
      if (dup) { dup._dirty = true; dup.invLink = dup.invLink || link || ''; return 'ซ้ำ: ใบกำกับ ' + no + ' ลงแล้ว'; }
      const cand = bills.filter(function (b) { return b.supplier === 'PRR' && !b.invNo && sameAmt_(b.amount, total); });
      cand.sort(function (a, b) {
        const pa = num_(a.paid) ? 0 : 1, pb = num_(b.paid) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return Math.abs(daysBetween_(a.payDate || a.date, date)) - Math.abs(daysBetween_(b.payDate || b.date, date));
      });
      const b = cand[0] || getBill_(bills, 'PRR|INV|' + no, 'PRR');
      b._dirty = true;
      if (!cand[0]) { b.no = '(ไม่มีใบเสนอราคา)'; b.date = date; b.amount = total; }
      setInvoice_(b, doc, link);
      return (cand[0] ? 'จับคู่บิล ' + b.no : 'ใบกำกับใหม่ ' + no);
    }
    return 'เก็บไฟล์ (' + kind + ')';
  }

  if (supplier === 'RRL') {
    if (kind === 'transfer_slip') {
      const b = getBill_(bills, 'RRL|' + ym_(date), 'RRL');
      b.no = 'ยอดเดือน ' + ym_(date); b.date = b.date || date; b.amount = b.amount || total;
      addPayment_(b, no || 'slip', date, total);
      return 'จ่ายรุ่งเรือง ' + fmtMoney_(total);
    }
    if (kind === 'tax_invoice') {
      const dup = bills.filter(function (b) { return b.supplier === 'RRL' && b.invNo === no; })[0];
      if (dup) return 'ซ้ำ: ใบกำกับ ' + no + ' ลงแล้ว';
      /* จับกับยอดโอนที่ยังไม่มีใบกำกับ: ยอดตรงก่อน ถ้าไม่มีใช้ยอดโอนล่าสุด (แล้วขึ้นรอตรวจว่ายอดไม่ตรง) */
      const paidOpen = bills.filter(function (b) { return b.supplier === 'RRL' && !b.invNo && num_(b.paid); })
        .sort(function (a, b) { return String(b.payDate).localeCompare(String(a.payDate)); });
      const cand = paidOpen.filter(function (b) { return sameAmt_(b.paid, total); })[0] || paidOpen[0];
      const b = cand || getBill_(bills, 'RRL|' + ym_(date), 'RRL');
      b._dirty = true;
      if (!cand && b.invNo) { addNote_(b, 'มีใบกำกับเดือนนี้มากกว่า 1 ใบ (' + no + ')'); return 'รอตรวจ: ใบกำกับรุ่งเรืองใบที่สอง'; }
      b.no = b.no || 'ยอดเดือน ' + ym_(date); b.date = b.date || date;
      setInvoice_(b, doc, link);
      if (num_(b.paid) && !sameAmt_(b.paid, total)) addNote_(b, 'ยอดใบกำกับ ' + fmtMoney_(total) + ' ไม่ตรงยอดโอน ' + fmtMoney_(b.paid));
      return 'ใบกำกับรุ่งเรือง ' + no;
    }
    return 'เก็บไฟล์ (' + kind + ')';
  }

  /* ยางเทรลเลอร์ / อื่นๆ: ใบกำกับมาพร้อมของ — ลงทะเบียนไว้ให้ครบ ไม่ต้องตาม */
  if (kind === 'tax_invoice' && no) {
    const b = getBill_(bills, supplier + '|' + no, supplier);
    b.no = no; b.date = date; b.amount = total; b.srcLink = link || b.srcLink;
    setInvoice_(b, doc, link);
    return 'ใบกำกับ ' + no;
  }
  return 'เก็บไฟล์ (' + kind + ')';
}

/* รายการที่ต้องทำวันนี้ — today = 'YYYY-MM-DD' (เวลาไทย) · lastJstarReport = วันที่รายงานบิลค้างเจสตาร์ล่าสุด */
function buildFollowups_(bills, today, lastJstarReport) {
  const out = [];
  const day = +today.slice(8, 10), last = lastDay_(today), thisYm = ym_(today);
  const push = function (sup, type, detail, msg) { out.push([today, SUPPLIERS[sup] ? SUPPLIERS[sup].name : sup, type, detail, msg || '']); };
  const listLines = function (arr) { return arr.map(function (b) { return dmy_(b.date) + ' ' + b.no + ' ' + fmtMoney_(b.amount); }).join('\n'); };
  const sum = function (arr) { return arr.reduce(function (s, b) { return s + num_(b.amount); }, 0); };
  const real = function (b) { return b.status !== 'ยกเลิก'; };

  /* ---- เจสตาร์ ---- */
  const jPend = bills.filter(function (b) { return b.supplier === 'JSTAR' && real(b) && !b.invNo && b.date && b.date <= today; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  const jMsg = function (arr) {
    return 'สวัสดีค่ะคุณเบียร์ รบกวนขอรูปถ่ายใบกำกับของบิลด้านล่างทางแชทนี้ก่อนได้ไหมคะ ตัวจริงฝากมากับรอบรถตามปกติได้เลยค่ะ\n\n' +
      listLines(arr) + '\n\nรวม ' + arr.length + ' บิล ' + fmtMoney_(sum(arr)) + ' บาท ขอบคุณค่ะ';
  };
  if (jPend.length && (dow_(today) === 1 || day === last)) {
    push('JSTAR', day === last ? 'ทวง (สิ้นเดือน)' : 'ทวง (รายสัปดาห์)', 'บิลยังไม่มีใบกำกับ ' + jPend.length + ' บิล ' + fmtMoney_(sum(jPend)) + ' บาท', jMsg(jPend));
  }
  const tail = jPend.filter(function (b) { return ym_(b.date) === thisYm && +b.date.slice(8, 10) > last - 4; });
  if (day > last - 4 && tail.length) {
    push('JSTAR', 'เสี่ยงข้ามเดือน', 'บิลช่วง 4 วันสุดท้ายยังไม่มีใบกำกับ ' + tail.length + ' บิล ' + fmtMoney_(sum(tail)) + ' บาท',
      'สวัสดีค่ะคุณเบียร์ บิลด้านล่างรบกวนออกใบกำกับลงวันที่ภายในเดือนนี้ได้ไหมคะ\n\n' + listLines(tail) + '\n\nขอบคุณค่ะ');
  }
  if (day >= 25 && !(lastJstarReport && ym_(lastJstarReport) === thisYm && +String(lastJstarReport).slice(8, 10) >= 25)) {
    push('JSTAR', 'ขอรายงานบิลค้าง', 'ยังไม่มีรายงานบิลค้างตั้งแต่วันที่ 25 (ใช้เก็บบิลส่งตรงลูกค้า)', 'รบกวนขอรายงานบิลค้างชำระล่าสุดของ YANGHAUS (C-P124) หน่อยค่ะ ขอบคุณค่ะ');
  }

  /* ---- ป.รุ่งโรจน์ / รุ่งเรือง: จ่ายแล้วครบ 2 วันยังไม่มีใบกำกับ → ทวง ซ้ำทุก 2 วัน ---- */
  bills.forEach(function (b) {
    if ((b.supplier !== 'PRR' && b.supplier !== 'RRL') || !real(b) || b.invNo || !num_(b.paid) || !b.payDate) return;
    const d = daysBetween_(b.payDate, today);
    if (d >= 2 && (d - 2) % 2 === 0) {
      const who = b.supplier === 'PRR' ? 'ชุดใบกำกับ (PDF) ' : 'ใบกำกับ ';
      push(b.supplier, 'ทวง', b.no + ' โอน ' + fmtMoney_(b.paid) + ' เมื่อ ' + dmy_(b.payDate) + ' ครบ ' + d + ' วัน ยังไม่มี' + who.trim(),
        'รบกวนขอ' + who + 'ของยอดโอน ' + fmtMoney_(b.paid) + ' บาท วันที่ ' + dmy_(b.payDate) + ' ด้วยนะคะ ขอบคุณค่ะ');
    }
  });

  /* ---- รุ่งเรือง: วันตัดยอด = 3 วันก่อนสิ้นเดือน ---- */
  if (day === last - 3) {
    push('RRL', 'ตัดยอด', 'วันนี้วันตัดยอดรุ่งเรือง: คุณอ้อยตรวจร่างสรุป → วางในกลุ่ม → ขอยอด → โอนภายในเดือน', '');
  }
  if (day > last - 3) {
    const m = findBill_(bills, 'RRL|' + thisYm);
    if (!m || !num_(m.paid)) push('RRL', 'ยังไม่โอน', 'เลยวันตัดยอดแล้ว ยังไม่มีสลิปโอนรุ่งเรืองของเดือนนี้ (โอนในเดือน = ใบกำกับลงวันที่ในเดือน)', '');
  }

  /* ---- ต้นเดือน: บิลเดือนก่อนที่ยังไม่มีใบกำกับ ---- */
  if (day <= 5) {
    const prev = bills.filter(function (b) { return real(b) && !b.invNo && b.date && ym_(b.date) < thisYm; });
    if (prev.length) push('OTHER', 'ค้างจากเดือนก่อน', 'บิลเดือนก่อนยังไม่มีใบกำกับ ' + prev.length + ' บิล ' + fmtMoney_(sum(prev)) + ' บาท (ต้องครบก่อนปิดยอดวันที่ 15)', listLines(prev));
  }

  /* ---- รอตรวจ ---- */
  bills.forEach(function (b) { if (b.review && real(b)) push(b.supplier, 'รอตรวจ', (b.no || b.key) + ': ' + b.review, ''); });
  return out;
}

/* =====================================================================
 * ส่วนที่ 2 — LINE webhook (รับอย่างเดียว)
 * ===================================================================== */
const KIND_TAG = { tax_invoice: 'ใบกำกับภาษี', delivery_note: 'ใบส่งสินค้า', receipt: 'ใบเสร็จ', outstanding_report: 'รายงานบิลค้าง', sales_order: 'ใบสั่งขาย',
  quotation: 'ใบเสนอราคา', order_ack: 'ใบรับจอง', credit_request: 'ใบขอวงเงิน', transfer_slip: 'สลิปโอน', platform_order: 'ออเดอร์' };

/* คอลัมน์ ตอบรับในแชท → '' (ไม่ตอบ) | 'key' (เฉพาะ ใบกำกับภาษี/ใบเสร็จรับเงิน ที่อ่านสำเร็จ) | 'all' (ทุกไฟล์) */
function ackMode_(v) {
  const t = String(v === true ? 'TRUE' : v || '').trim();
  if (/สำคัญ/.test(t)) return 'key';
  if (t.toUpperCase() === 'TRUE' || /ทุก/.test(t)) return 'all';
  return '';
}
const KEY_KINDS = ['tax_invoice', 'receipt'];      // Thipwon 19 พ.ย.: ในกลุ่มซัพพลายเออร์ตอบแค่ ใบกำกับภาษี กับ ใบเสร็จรับเงิน

/* ข้อความตอบรับ "ข้อความเดียว" สำหรับเอกสารที่ส่งมาชุดเดียวกัน — items = [{status, kind, no, result}] · คืน '' = ไม่ต้องตอบ
 * แจ้งแค่ชนิด + เลขที่เอกสาร (ไม่แจ้งยอดเงิน) · โหมด key: เฉพาะ ใบกำกับภาษี/ใบเสร็จรับเงิน ที่อ่านสำเร็จ กรณีอื่นเงียบ */
function ackSummary_(items, mode) {
  const done = items.filter(function (r) { return r.status === 'DONE'; });
  const kinds = KEY_KINDS.slice();
  if (mode === 'all') done.forEach(function (r) { if (kinds.indexOf(r.kind) < 0) kinds.push(r.kind); });
  const lines = [];
  kinds.forEach(function (k) {
    /* เลขเดียวกันหลายไฟล์ (ต้นฉบับ + สำเนา) แสดงครั้งเดียว: ไม่มีวงเล็บถ้ามีใบที่เก็บจริง · (สำเนา) ถ้าได้แค่สำเนา · (ซ้ำ) ถ้าซ้ำทั้งหมด */
    const tag = {}, order = [];
    done.forEach(function (r) {
      if (r.kind !== k || (r.quiet && mode !== 'all')) return;
      const no = r.no || '(ไม่มีเลขที่)', res = String(r.result || '');
      const t = /^ซ้ำ/.test(res) ? 2 : (/สำเนา/.test(res) ? 1 : 0);
      if (!(no in tag)) { tag[no] = t; order.push(no); } else tag[no] = Math.min(tag[no], t);
    });
    const nos = order.map(function (no) { return no + (tag[no] === 2 ? ' (ซ้ำ)' : tag[no] === 1 ? ' (สำเนา)' : ''); });
    if (nos.length) lines.push('✅ เก็บ' + (KIND_TAG[k] || 'เอกสาร') + 'แล้ว' + (nos.length > 1 ? ' ' + nos.length + ' ใบ' : '') + ': ' + nos.join(', '));
  });
  const skip = items.filter(function (r) { return r.status === 'SKIP'; }).length;
  const wait = items.filter(function (r) { return r.status !== 'DONE' && r.status !== 'SKIP'; }).length;
  if (mode === 'all' && skip) lines.push('ℹ️ ไม่ใช่เอกสาร ' + skip + ' ไฟล์ (ไม่ได้เก็บ)');
  /* โหมด key: บอกจำนวนที่ยังอ่านไม่เสร็จเฉพาะเมื่อมีบรรทัดเก็บแล้วอยู่ด้วย — ไม่งั้นส่ง 15 ใบแล้วบอทตอบ "4 ใบ" คนจะคิดว่าที่เหลือหาย */
  if (wait && (mode === 'all' || lines.length)) lines.push('📥 อีก ' + wait + ' ไฟล์รับแล้ว กำลังอ่านต่อ');
  if (lines.length) lines.push('🙏 ยางเฮ้าส์ ขอบคุณค่ะ');
  return lines.join('\n');
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function ss_() { return SpreadsheetApp.openById(SHEET_ID); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
// ใช้ HtmlService เพราะ ContentService ตอบ 302 redirect ซึ่ง LINE ถือว่า error (ต้องได้ 200 ตรง ๆ)
function json_(o) { return HtmlService.createHtmlOutput(JSON.stringify(o)); }
function getOrCreate_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function nextRow_(sh) {
  const a = sh.getRange('A:A').getValues(); let last = 0;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== '' && a[i][0] !== null) last = i + 1;
  return last + 1;
}
function appendRow_(sh, row) { sh.getRange(nextRow_(sh), 1, 1, row.length).setValues([row]); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { const r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}

function doGet() { return json_({ ok: true, app: 'YH Purchase' }); }

function doPost(e) {
  try {
    if (!e || !e.parameter || e.parameter.k !== prop_('WEBHOOK_KEY')) return json_({ ok: false });
    const body = JSON.parse(e.postData.contents || '{}');
    const events = body.events || [];
    const acks = [];
    if (!events.length) return json_({ ok: true });            // ปุ่ม Verify ของ LINE ส่ง events ว่าง
    /* ไม่ล็อกทั้งก้อน: ส่งรูปพร้อมกัน 15 ใบ = 15 webhook พร้อมกัน ถ้าต่อคิวล็อกตอนดาวน์โหลดไฟล์ ใบท้าย ๆ จะรอจนหมดเวลาแล้วหาย
     * จึงดาวน์โหลด/เซฟไฟล์นอกล็อก แล้วล็อกเฉพาะตอนเขียนชีท (withLock_) ซึ่งใช้เวลาสั้นมาก */
    const ss = ss_();
    const cfg = readCfg_(ss);
    events.forEach(function (ev) { try { handleEvent_(ss, cfg, ev, acks); } catch (err) { console.error('event ' + err); } });
    if (acks.length) ackCollect_();
  } catch (err) { console.error('doPost ' + err); }
  return json_({ ok: true });
}

/* แท็บ บอท-ตั้งค่า → { id: {row, type, supplier, name, on, text} } */
function readCfg_(ss) {
  const sh = ss.getSheetByName(TAB_CFG);
  const v = sh.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    map[String(v[i][0])] = { row: i + 1, type: v[i][1], supplier: String(v[i][2] || '').toUpperCase().trim(), name: v[i][3],
      on: v[i][4] === true || String(v[i][4]).toUpperCase() === 'TRUE', text: String(v[i][5] || 'keyword').toLowerCase().trim(),
      ack: ackMode_(v[i][8]),
      alert: v[i][9] === true || String(v[i][9]).toUpperCase() === 'TRUE' };
  }
  return map;
}

function sourceId_(ev) { const s = ev.source || {}; return s.groupId || s.roomId || s.userId || ''; }

/* แหล่งใหม่ (กลุ่มที่เพิ่งถูกเชิญ / คนที่ทักบอทครั้งแรก) → เพิ่มแถวในแท็บตั้งค่า แบบ "ยังไม่เปิดใช้" รอ Thipwon ติ๊กเอง */
function registerSource_(ss, cfg, ev) {
  const id = sourceId_(ev);
  if (!id || cfg[id]) return;
  withLock_(function () { registerSourceLocked_(ss, cfg, ev, id); });
}
function registerSourceLocked_(ss, cfg, ev, id) {
  const fresh = readCfg_(ss);                                    // webhook อื่นอาจเพิ่งลงทะเบียนแหล่งเดียวกันไปแล้ว
  if (fresh[id]) { cfg[id] = fresh[id]; return; }
  const isGroup = !!((ev.source || {}).groupId);
  let name = '';
  try {
    const url = isGroup ? 'https://api.line.me/v2/bot/group/' + id + '/summary' : 'https://api.line.me/v2/bot/profile/' + id;
    const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { const j = JSON.parse(r.getContentText()); name = j.groupName || j.displayName || ''; }
  } catch (err) {}
  const sh = ss.getSheetByName(TAB_CFG);
  const row = nextRow_(sh);
  /* ตอบรับในแชท: กลุ่ม = ปิดไว้ก่อน (กลุ่มซัพพลายเออร์ห้ามบอทพูด) · แชท 1:1 = เปิด */
  sh.getRange(row, 1, 1, 10).setValues([[id, isGroup ? 'group' : 'user', isGroup ? '' : 'AUTO', name, false, isGroup ? 'keyword' : 'none', 'ใหม่ — เลือกซัพพลายเออร์แล้วติ๊กเปิดใช้', now_(), isGroup ? 'ไม่ตอบ' : 'ทุกไฟล์', isGroup ? '' : false]]);
  sh.getRange(row, 5).insertCheckboxes();
  if (!isGroup) sh.getRange(row, 10).insertCheckboxes();
  sh.getRange(row, 9).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ไม่ตอบ', 'เฉพาะเอกสารสำคัญ', 'ทุกไฟล์'], true).build());
  cfg[id] = { row: row, type: isGroup ? 'group' : 'user', supplier: '', name: name, on: false, text: 'none', ack: '', alert: false };
}

function handleEvent_(ss, cfg, ev, acks) {
  if (ev.type === 'join' || ev.type === 'follow') { registerSource_(ss, cfg, ev); return; }
  if (ev.type !== 'message') return;
  registerSource_(ss, cfg, ev);
  const src = cfg[sourceId_(ev)];
  if (!src || !src.on) return;                                   // แหล่งที่ยังไม่เปิดใช้: ไม่เก็บอะไรเลย
  const m = ev.message || {};
  const when = Utilities.formatDate(new Date(ev.timestamp || Date.now()), TZ, 'yyyy-MM-dd HH:mm:ss');
  const sender = (ev.source || {}).userId || '';

  if (m.type === 'text') {
    const keep = src.text === 'all' || (src.text === 'keyword' && TEXT_KEYWORDS.test(m.text || ''));
    if (keep) withLock_(function () { appendRow_(ss.getSheetByName(TAB_TEXT), [when, src.name, src.supplier, sender, String(m.text || '').slice(0, 2000)]); });
    return;
  }
  if (m.type !== 'image' && m.type !== 'file') return;           // สติกเกอร์ วิดีโอ เสียง ตำแหน่ง: ไม่เก็บ
  if (m.type === 'file' && !/\.(pdf|jpe?g|png)$/i.test(m.fileName || '')) return;

  const q = ss.getSheetByName(TAB_QUEUE);
  let fileId = '', status = 'NEW', err = '';
  try {
    /* ต้องใช้ /content (ไฟล์เต็ม) ไม่ใช่ /content/preview และต้องเซฟทันที เพราะ LINE ลบไฟล์เองโดยไม่บอกเวลา */
    const r = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + m.id + '/content',
      { headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('LINE content ' + r.getResponseCode());
    const blob = r.getBlob();
    const ext = m.type === 'file' ? (String(m.fileName).split('.').pop() || 'pdf').toLowerCase() : (/png/.test(blob.getContentType()) ? 'png' : 'jpg');
    blob.setName(when.replace(/[: ]/g, '-') + '_' + (src.supplier || 'NA') + '_' + m.id + '.' + ext);
    const inbox = getOrCreate_(DriveApp.getFolderById(FOLDER_ID), INBOX_NAME);
    fileId = inbox.createFile(blob).getId();
  } catch (e2) {
    status = 'ERR'; err = String(e2).slice(0, 200);
    alertAdmins_(ss, '⚠️ รับไฟล์จาก LINE ไม่สำเร็จ จาก ' + (src.name || 'ไม่ทราบแหล่ง') + ' เมื่อ ' + when.slice(5, 16) + '\nไฟล์นี้ไม่ได้ถูกเก็บ ต้องให้ส่งใหม่หรือดาวน์โหลดเอง\n(' + err.slice(0, 80) + ')', 'dl_' + sourceId_(ev));
  }
  /* คอลัมน์ 20 = โหมด|เวลารับ(ms)|replyToken — เก็บชั่วคราวให้ ackCollect_ รวมตอบทีเดียว แล้วล้างทิ้ง */
  const pend = src.ack && ev.replyToken ? src.ack + '|' + Date.now() + '|' + ev.replyToken : '';
  const qRow = withLock_(function () {
    const r = nextRow_(q);
    q.getRange(r, 1, 1, 20).setValues([[when, src.name, src.supplier, sender, m.type, String(m.id), fileId, status, '', '', '', '', '', '', '', '', '', 0, err, pend]]);
    return r;
  });
  if (pend && acks) acks.push(qRow);
}

/* ตอบรับในแชท — รวมเอกสารที่ส่งมาชุดเดียวกันเป็น "ข้อความเดียว"
 * LINE ส่งรูปแต่ละใบมาเป็น webhook แยกกัน → ทุก webhook ฝาก replyToken ไว้ในคิว (คอลัมน์ 20) แล้วตัวที่ได้ user lock เป็น "ผู้รวม":
 * 1) รอจนไม่มีใบใหม่เข้ามา 2 วินาที (ไม่เกิน 10 วินาที)  2) อ่านทุกใบพร้อมกัน  3) ตอบครั้งเดียวทันทีที่อ่านเสร็จ  4) ค่อยย้ายไฟล์/เขียนชีท
 * reply ไม่นับโควต้า · token ใช้ได้ครั้งเดียวภายใน ~1 นาที → ใบที่อ่านไม่ทันจะถูกนับเป็น "กำลังอ่านต่อ" แล้ว processQueue อ่านให้ในรอบ 5 นาที */
const ACK_MAX = 20;
function ackCollect_() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(25000)) return;                              // มีผู้รวมทำงานอยู่ — เขาจะเห็นแถวของเราเอง
  try {
    const ss = ss_(), q = ss.getSheetByName(TAB_QUEUE);
    const t0 = Date.now();
    let pend = [], last = -1, stable = 0;
    while (Date.now() - t0 < 10000) {
      SpreadsheetApp.flush();
      pend = pendingAcks_(q);
      if (!pend.length) return;
      if (pend.length === last) { if (++stable >= 2) break; } else { stable = 0; last = pend.length; }
      Utilities.sleep(1000);
    }
    let sent = false;
    const send = function (res) {
      if (sent) return; sent = true;
      const now = Date.now(), groups = {};
      pend.forEach(function (p) {
        const g = groups[p.source] || (groups[p.source] = { mode: p.mode, ms: 0, token: '', items: [] });
        if (p.ms > g.ms) { g.ms = p.ms; g.token = p.token; }
        g.items.push(res[p.row] || { status: p.status === 'NEW' ? 'NEW' : p.status, kind: p.kind, no: p.no, result: p.result });
      });
      for (const name in groups) {
        const g = groups[name];
        try { const text = ackSummary_(g.items, g.mode); if (text && g.token && now - g.ms < 55000) replyText_(g.token, text); }
        catch (err) { console.error('reply ' + err); }
      }
    };
    const rows = pend.filter(function (p) { return p.status === 'NEW' && p.fileId; }).map(function (p) { return p.row; }).slice(0, ACK_MAX);
    try { if (rows.length) processRows_(ss, rows, t0 + 40000, send); } finally {
      send({});                                                   // ไม่มีอะไรให้อ่าน หรืออ่านล้มทั้งชุด ก็ยังตอบตามสถานะที่มี
      pend.forEach(function (p) { q.getRange(p.row, 20).setValue(''); });
    }
  } catch (err) { console.error('ackCollect ' + err); } finally { lock.releaseLock(); }
}

/* แถวในคิวที่ยังรอตอบรับ (ทิ้งของค้างเกิน 90 วินาที เช่นสคริปต์ล่มรอบก่อน) */
function pendingAcks_(q) {
  const v = q.getDataRange().getDisplayValues(), now = Date.now(), out = [];
  for (let i = 1; i < v.length; i++) {
    if (!v[i][19]) continue;
    const p = String(v[i][19]).split('|'), ms = +p[1];
    if (now - ms > 90000) { q.getRange(i + 1, 20).setValue(''); continue; }
    out.push({ row: i + 1, source: v[i][1], mode: p[0], ms: ms, token: p.slice(2).join('|'), status: v[i][7], fileId: v[i][6], kind: v[i][8], no: v[i][10], result: v[i][15] });
  }
  return out;
}

function replyText_(token, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', { method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') }, payload: JSON.stringify({ replyToken: token, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }), muteHttpExceptions: true });
}

/* =====================================================================
 * ส่วนที่ 3 — อ่านเอกสารในคิว (ตั้งเวลาเรียกทุก 5 นาที)
 * ===================================================================== */
const DOC_PROMPT =
  'You read ONE image or PDF that was posted in a LINE chat between a Thai tire/wheel shop (buyer: YANGHAUS / ยางเฮ้าส์ / บริษัท ตามโกล์บ จำกัด, tax id 0105555164164) and its suppliers. ' +
  'Return ONLY JSON with keys:\n' +
  'is_document (false for photos of tires/wheels/goods/people/maps/stickers/chat screenshots without a document; true for business documents and bank slips),\n' +
  'title (the document heading exactly as printed, e.g. "ใบส่งสินค้า", "ใบส่งสินค้า/ใบกำกับภาษี", "ใบเสร็จรับเงิน", "ใบเสนอราคา"),\n' +
  'doc_type (one of: delivery_note | tax_invoice | receipt | outstanding_report | sales_order | quotation | order_ack | credit_request | transfer_slip | platform_order | other). ' +
  'Rules: heading containing ใบกำกับภาษี with a VAT 7% line = tax_invoice even if it also says ใบส่งสินค้า. Heading only ใบส่งสินค้า with VAT 0% = delivery_note. ' +
  'ใบเสร็จรับเงิน listing several bill numbers = receipt. รายงานลูกหนี้ภาระบิลค้างชำระ = outstanding_report. ใบสั่งขาย = sales_order. ใบเสนอราคา = quotation. ใบรับจอง/ใบสั่งซื้อสินค้า = order_ack. ใบคำขอวงเงินเครดิต = credit_request. Banking app transfer success screen = transfer_slip. Shopee/TikTok order sheet = platform_order.\n' +
  'seller (issuer name as printed; for transfer_slip leave empty), seller_tax_id (13 digits, digits only, or empty),\n' +
  'payee (transfer_slip only: recipient account name),\n' +
  'customer_code (customer code printed on the document such as C-P124, or empty),\n' +
  'doc_no (the document\'s own number exactly as printed, keep letters and leading zeros; transfer_slip → transaction reference),\n' +
  'doc_date (YYYY-MM-DD of the document; convert Buddhist year by subtracting 543, e.g. 18/11/2569 → 2026-11-18),\n' +
  'ref_no (the number printed in the "อ้างอิง" or "เลขที่สั่งของลูกค้า" field if any, exactly as printed, else empty),\n' +
  'total (grand total / amount transferred, number), vat (VAT amount, number, 0 if none),\n' +
  'lines (ONLY for receipt and outstanding_report: array of {doc_no, doc_date (YYYY-MM-DD), amount (original bill amount), paid (amount paid on this receipt; for outstanding_report use 0)} — one per listed bill; otherwise []),\n' +
  'items (short Thai summary of goods, max 80 chars), confidence (0-1).\n' +
  'Read digits carefully; do not guess unreadable digits — put what you can read.';

function geminiModels_(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('gemini_models');
  if (hit) return JSON.parse(hit);
  let names = [];
  try {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + key, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      names = (JSON.parse(r.getContentText()).models || [])
        .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
        .map(function (m) { return m.name.replace('models/', ''); })
        .filter(function (n) { return !/tts|audio|image|embedding|live|preview|exp|thinking/i.test(n); });
    }
  } catch (e) {}
  const ordered = [];
  GEMINI_PREFER.forEach(function (p) { names.forEach(function (n) { if (n.indexOf(p) === 0 && ordered.indexOf(n) < 0) ordered.push(n); }); });
  const list = ordered.length ? ordered.slice(0, 4) : GEMINI_PREFER;
  cache.put('gemini_models', JSON.stringify(list), 21600);
  return list;
}
function geminiFetch_(key, body) {
  const props = PropertiesService.getScriptProperties();
  const models = geminiModels_(key);
  const remembered = props.getProperty('GEMINI_MODEL_OK');
  const order = remembered && models.indexOf(remembered) >= 0 ? [remembered].concat(models.filter(function (m) { return m !== remembered; })) : models;
  const opt = { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true };
  let res = null, best = null;
  for (const m of order) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + key;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = UrlFetchApp.fetch(url, opt);
      const c = res.getResponseCode();
      if (c === 404) break;
      if (c === 503 || c === 429) { best = res; Utilities.sleep(1500); continue; }
      if (c === 200 && m !== remembered) props.setProperty('GEMINI_MODEL_OK', m);
      return res;
    }
  }
  return best || res;
}
function geminiJson_(parts) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) throw new Error('ไม่มี GEMINI_API_KEY');
  const res = geminiFetch_(key, { contents: [{ parts: parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } });
  const code = res.getResponseCode(), raw = res.getContentText();
  if (code !== 200) throw new Error('Gemini ' + code + ' ' + raw.slice(0, 120));
  return parseGemini_(raw);
}
function parseGemini_(raw) {
  const cand = (JSON.parse(raw).candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('Gemini ไม่มีคำตอบ (' + (cand.finishReason || '?') + ')');
  return JSON.parse(text.replace(/^```json|```$/g, '').trim());
}
function readDoc_(file) {
  const blob = file.getBlob();
  const mime = blob.getContentType();
  if (!/pdf|image\//.test(mime)) return { is_document: false };
  const d = geminiJson_([{ text: DOC_PROMPT }, { inline_data: { mime_type: mime, data: Utilities.base64Encode(blob.getBytes()) } }]);
  return Array.isArray(d) ? d[0] : d;
}
/* อ่านหลายไฟล์พร้อมกัน (fetchAll) ด้วยรุ่นที่ใช้ได้ล่าสุด — คืน array ตามลำดับ · null = ใบนั้นไม่สำเร็จ ให้ผู้เรียกอ่านทีละใบด้วย readDoc_ แทน */
function readDocsParallel_(files) {
  const out = files.map(function () { return null; });
  try {
    const key = prop_('GEMINI_API_KEY');
    const model = prop_('GEMINI_MODEL_OK') || geminiModels_(key)[0];
    const reqs = [], idx = [];
    files.forEach(function (f, k) {
      if (!f) return;
      const blob = f.getBlob(), mime = blob.getContentType();
      if (!/pdf|image\//.test(mime)) { out[k] = { is_document: false }; return; }
      idx.push(k);
      reqs.push({ url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ contents: [{ parts: [{ text: DOC_PROMPT }, { inline_data: { mime_type: mime, data: Utilities.base64Encode(blob.getBytes()) } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) });
    });
    if (!reqs.length) return out;
    UrlFetchApp.fetchAll(reqs).forEach(function (res, j) {
      try { if (res.getResponseCode() === 200) { const d = parseGemini_(res.getContentText()); out[idx[j]] = Array.isArray(d) ? d[0] : d; } } catch (e) {}
    });
  } catch (err) { console.error('parallel ' + err); }
  return out;
}

/* ทะเบียนบิล ↔ ชีท */
function readBills_(ss) {
  const sh = ss.getSheetByName(TAB_BILL);
  const v = sh.getDataRange().getDisplayValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; if (!r[0]) continue;
    out.push({ key: r[0], supplier: supplierKey_(r[1]), date: r[2], no: r[3], amount: num_(r[4]), hasDN: /TRUE/i.test(r[5]), srcLink: r[6],
      paid: num_(r[7]), payDate: r[8], payRef: r[9], invNo: r[10], invDate: r[11], invAmount: num_(r[12]), invLink: r[13],
      original: /TRUE/i.test(r[14]), status: r[15], review: r[16], updated: r[17], _row: i + 1, _dirty: false });
  }
  return out;
}
function supplierKey_(name) { for (const k in SUPPLIERS) if (SUPPLIERS[k].name === name || k === name) return k; return 'OTHER'; }
function writeBills_(ss, bills) {
  const sh = ss.getSheetByName(TAB_BILL);
  bills.forEach(function (b) {
    if (!b._dirty) return;
    /* "ยกเลิก" และ "ได้ตัวจริง" เป็นของคน: อ่านค่าล่าสุดจากชีทก่อนเขียน ไม่ทับ */
    if (b._row) {
      const cur = sh.getRange(b._row, 15, 1, 2).getDisplayValues()[0];
      b.original = /TRUE/i.test(cur[0]);
      if (cur[1] === 'ยกเลิก') b.status = 'ยกเลิก';
    }
    if (b.status !== 'ยกเลิก') b.status = billStatus_(b);
    b.updated = now_();
    const row = [b.key, SUPPLIERS[b.supplier] ? SUPPLIERS[b.supplier].name : b.supplier, b.date, b.no, b.amount || '', b.hasDN, b.srcLink,
      b.paid || '', b.payDate, b.payRef, b.invNo, b.invDate, b.invAmount || '', b.invLink, b.original, b.status, b.review, b.updated];
    if (!b._row) { b._row = nextRow_(sh); }
    sh.getRange(b._row, 1, 1, row.length).setValues([row]);
    sh.getRange(b._row, 6).insertCheckboxes(); sh.getRange(b._row, 15).insertCheckboxes();
    b._dirty = false;
  });
}

/* ย้ายไฟล์จาก inbox ไปโฟลเดอร์เดือน: ใบกำกับ → ภาษีซื้อ · เอกสารอื่น → เอกสารซื้อ/<ซัพพลายเออร์> */
function fileAway_(file, doc, supplier, kind, received) {
  const ymd = doc.doc_date || String(received).slice(0, 10);
  const root = DriveApp.getFolderById(FOLDER_ID);
  const month = getOrCreate_(root, ym_(ymd));
  const dest = kind === 'tax_invoice' ? getOrCreate_(month, SUB_VAT)
    : getOrCreate_(getOrCreate_(month, SUB_DOCS), SUPPLIERS[supplier].name);
  const tag = { tax_invoice: 'ใบกำกับ', delivery_note: 'ใบส่งสินค้า', receipt: 'ใบเสร็จ', outstanding_report: 'บิลค้าง', sales_order: 'ใบสั่งขาย',
    quotation: 'ใบเสนอราคา', order_ack: 'ใบรับจอง', credit_request: 'ขอวงเงิน', transfer_slip: 'สลิป', platform_order: 'ออเดอร์' }[kind] || 'เอกสาร';
  const ext = (file.getName().split('.').pop() || 'jpg').toLowerCase();
  const safe = function (s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40); };
  file.setName([ymd, SUPPLIERS[supplier].name, tag, num_(doc.total) ? num_(doc.total).toFixed(2) : '', safe(normDocNo_(doc.doc_no))].filter(String).join('_') + '.' + ext);
  file.moveTo(dest);
  return file.getUrl();
}

function processQueue() {
  /* ใช้ user lock (กันรันซ้อนกันเอง) คนละตัวกับ script lock ของ webhook — ไม่งั้น webhook จะรอคิวอ่าน Gemini จนหมดเวลาแล้วเอกสารหาย */
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return;
  try { processRows_(ss_(), null, 0); } finally { lock.releaseLock(); }
}

/* อ่านเอกสารในคิว — onlyRows = เลขแถวที่ต้องการ (ตอบรับทันที) หรือ null = แถว NEW ทั้งหมดไม่เกิน BATCH
 * deadline = เวลา (ms) ที่ต้องหยุดอ่านใบใหม่ · 0 = ไม่จำกัด · ผู้เรียกต้องถือ user lock อยู่แล้ว
 * afterRead(out) = เรียกทันทีที่ "อ่าน + จับคู่ในหน่วยความจำ" เสร็จ ก่อนย้ายไฟล์/เขียนชีท (ส่วนที่ช้า) — ใช้ส่งข้อความตอบรับให้ทัน
 * คืน { เลขแถว: {status, kind, supplierName, no, total, result} } */
function processRows_(ss, onlyRows, deadline, afterRead) {
  const out = {};
  const q = ss.getSheetByName(TAB_QUEUE);
  const v = q.getDataRange().getDisplayValues();
  const todo = [], cap = onlyRows ? ACK_MAX : BATCH;
  for (let i = 1; i < v.length && todo.length < cap; i++) {
    if (v[i][7] !== 'NEW' || !v[i][6]) continue;
    if (onlyRows && onlyRows.indexOf(i + 1) < 0) continue;
    todo.push(i);
  }
  if (!todo.length) { if (afterRead) afterRead(out); return out; }
  const bills = readBills_(ss);
  const seen = {};                                             // กันเอกสารซ้ำ: ซัพพลายเออร์ + ชนิด + เลขที่
  for (let i = 1; i < v.length; i++) {
    if (v[i][7] !== 'DONE' || !v[i][10] || /^ซ้ำ/.test(v[i][15])) continue;
    seen[v[i][2] + '|' + v[i][8] + '|' + v[i][10]] = { copy: /สำเนา/.test(v[i][15]), link: v[i][16], plan: null };
  }

  /* ขั้น A — อ่าน: หลายใบอ่านพร้อมกันก่อน ใบที่ไม่สำเร็จค่อยอ่านเดี่ยว แล้วจับคู่ในหน่วยความจำ (ยังไม่แตะ Drive/ชีท) */
  const files = todo.map(function (i) { try { return DriveApp.getFileById(v[i][6]); } catch (e) { return null; } });
  const pre = todo.length > 1 ? readDocsParallel_(files) : [];
  const plan = [];
  todo.forEach(function (i, k) {
    const row = i + 1, tries = num_(v[i][17]) + 1;
    if (!pre[k] && deadline && Date.now() > deadline) return;      // หมดเวลา: ปล่อยเป็น NEW ให้รอบถัดไป
    try {
      const file = files[k] || DriveApp.getFileById(v[i][6]);
      const doc = pre[k] || readDoc_(file) || {};
      if (!doc.is_document) { plan.push({ row: row, file: file, skip: true }); out[row] = { status: 'SKIP' }; return; }
      let supplier = String(v[i][2] || '').toUpperCase();
      if (!SUPPLIERS[supplier] || supplier === 'OTHER') supplier = detectSupplier_(doc);   // AUTO (แชท 1:1) → ดูจากผู้ขาย/ผู้รับโอน
      const kind = docKind_(doc);
      const no = normDocNo_(doc.doc_no);
      const dupKey = supplier + '|' + kind + '|' + no;
      const prev = no ? seen[dupKey] : null;
      const copy = kind === 'tax_invoice' && isCopy_(doc);
      const upgrade = !!(prev && prev.copy && kind === 'tax_invoice' && !copy);   // เคยได้แค่สำเนา แล้วต้นฉบับตามมา → ใช้ต้นฉบับแทน
      const isDup = !!(prev && !upgrade);
      const link = isDup ? '' : file.getUrl();                     // ลิงก์ไฟล์ไม่เปลี่ยนเมื่อย้าย/เปลี่ยนชื่อ
      let result;
      if (isDup) result = 'ซ้ำ: เคยลงแล้ว';
      else if (upgrade) {
        result = 'ได้ต้นฉบับแล้ว (แทนใบเดิม)';
        bills.forEach(function (b) { if (b.supplier === supplier && b.invNo === no) { b.invLink = link; dropNote_(b, COPY_NOTE); b._dirty = true; } });
        if (prev.plan) { prev.plan.isDup = true; prev.plan.link = ''; prev.plan.result = 'ซ้ำ: มีต้นฉบับแล้ว'; out[prev.plan.row].result = prev.plan.result; }
        else if (prev.link) plan.push({ trashLink: prev.link });
      } else {
        result = applyDoc_(bills, doc, supplier, link);
        if (copy) { result += ' · สำเนา'; bills.forEach(function (b) { if (b.supplier === supplier && b.invNo === no) { addNote_(b, COPY_NOTE); b._dirty = true; } }); }
      }
      const pl = { row: row, file: file, doc: doc, supplier: supplier, kind: kind, no: no, isDup: isDup, link: link, result: result, tries: tries, received: v[i][0] };
      if (no && !isDup) seen[dupKey] = { copy: copy, link: link, plan: pl };
      plan.push(pl);
      /* quiet = เก็บเงียบ ๆ ไม่ตอบในกลุ่ม: ใบเสร็จของ ป.รุ่งโรจน์ มากับชุดใบกำกับเลขเดียวกันเสมอ (Thipwon 19 พ.ย.) */
      out[row] = { status: 'DONE', kind: kind, supplierName: SUPPLIERS[supplier].name, no: no, total: num_(doc.total), result: result, quiet: supplier === 'PRR' && kind === 'receipt' };
    } catch (err) {
      /* เพดาน Gemini เต็ม/ระบบไม่ว่าง (429, 503): ไม่นับเป็นความผิดพลาดของเอกสาร ลองใหม่รอบถัดไปได้เรื่อย ๆ */
      const busy = /Gemini (429|503)/.test(String(err));
      plan.push({ row: row, err: String(err).slice(0, 200), tries: busy ? tries - 1 : tries, source: v[i][1], received: v[i][0], fileId: v[i][6] });
      out[row] = { status: 'ERR' };
    }
  });
  if (afterRead) { try { afterRead(out); } catch (e) { console.error('afterRead ' + e); } }

  /* ขั้น B — เก็บ: ย้ายไฟล์เข้าโฟลเดอร์เดือน เขียนคิว เขียนทะเบียน (ถ้าล่มกลางทาง แถวยังเป็น NEW รอบถัดไปทำซ้ำได้) */
  plan.forEach(function (p) {
    try {
      if (p.trashLink) { const m = /\/d\/([^/]+)/.exec(p.trashLink); if (m) DriveApp.getFileById(m[1]).setTrashed(true); return; }   // สำเนาที่ถูกแทนด้วยต้นฉบับ
      if (p.err) { q.getRange(p.row, 8).setValue(p.tries >= MAX_TRIES ? 'ERR' : 'NEW'); q.getRange(p.row, 18, 1, 2).setValues([[p.tries, p.err]]); return; }
      if (p.skip) { p.file.setTrashed(true); q.getRange(p.row, 8, 1, 2).setValues([['SKIP', 'ไม่ใช่เอกสาร']]); return; }
      /* เอกสารซ้ำ (เลขที่เดิม ชนิดเดิม ซัพพลายเออร์เดิม): ไม่เก็บไฟล์ซ้ำใน Drive ทิ้งลงถังขยะ */
      if (p.isDup) p.file.setTrashed(true); else fileAway_(p.file, p.doc, p.supplier, p.kind, p.received);
      q.getRange(p.row, 3).setValue(p.supplier);
      q.getRange(p.row, 8, 1, 12).setValues([['DONE', p.kind, p.doc.seller || p.doc.payee || '', p.no, p.doc.doc_date || '', normDocNo_(p.doc.ref_no),
        num_(p.doc.total) || '', num_(p.doc.vat) || '', p.result, p.link, p.tries, '']]);
    } catch (err) { console.error('store row ' + p.row + ' ' + err); }
  });
  writeBills_(ss, bills);

  /* อ่านไม่ผ่านครบ MAX_TRIES → แจ้งคนทางแชทส่วนตัว ข้อความเดียวต่อรอบ */
  const dead = plan.filter(function (p) { return p.err && p.tries >= MAX_TRIES; });
  if (dead.length) {
    const from = dead.map(function (p) { return p.source; }).filter(function (x, k, a) { return x && a.indexOf(x) === k; }).join(', ');
    alertAdmins_(ss, '⚠️ อ่านเอกสารไม่ได้ ' + dead.length + ' ไฟล์ จาก ' + (from || '-') + '\nส่งเมื่อ ' + String(dead[0].received).slice(5, 16) +
      '\nไฟล์ยังอยู่ใน Drive แต่ยังไม่ได้ลงทะเบียน:\n' + dead.slice(0, 5).map(function (p) { return 'https://drive.google.com/file/d/' + p.fileId + '/view'; }).join('\n'));
  }
  return out;
}

/* =====================================================================
 * ส่วนที่ 4 — งานรายวัน 08:30: เขียนแท็บ ตามใบกำกับ ให้ "สรุปเช้า" (09:22) อ่าน + ร่างสรุปรุ่งเรืองวันตัดยอด
 * ===================================================================== */
function dailyJob() {
  const ss = ss_();
  const today = today_();
  const bills = readBills_(ss);
  const q = ss.getSheetByName(TAB_QUEUE).getDataRange().getDisplayValues();
  let lastReport = '';
  for (let i = 1; i < q.length; i++) if (q[i][7] === 'DONE' && q[i][2] === 'JSTAR' && q[i][8] === 'outstanding_report' && q[i][11] > lastReport) lastReport = q[i][11];
  const rows = buildFollowups_(bills, today, lastReport);
  const stuck = q.filter(function (r) { return r[7] === 'ERR'; }).length;
  if (stuck) rows.push([today, 'ระบบ', 'อ่านไม่ได้', 'มีเอกสาร ' + stuck + ' ไฟล์ที่บอทอ่านไม่สำเร็จ ดูแท็บ บอท-คิว (สถานะ ERR)', '']);

  const day = +today.slice(8, 10), last = lastDay_(today);
  if (day === last - 3) {
    try {
      const draft = draftRrlSummary_(ss, today);
      rows.push([today, SUPPLIERS.RRL.name, 'ร่างสรุปยอด', 'ร่างจากข้อความในกลุ่ม (คุณอ้อยต้องตรวจก่อนส่ง)', draft]);
      const oi = prop_('OI_USER_ID');
      if (oi && draft) pushText_(oi, 'ร่างสรุปยอดรุ่งเรืองเดือนนี้ (ตรวจแล้วคัดลอกไปวางในกลุ่มได้เลยค่ะ)\n\n' + draft);
    } catch (err) { rows.push([today, SUPPLIERS.RRL.name, 'ร่างสรุปยอด', 'ร่างไม่สำเร็จ: ' + String(err).slice(0, 120), '']); }
  }

  const sh = ss.getSheetByName(TAB_FOLLOW);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), FOLLOW_HEAD.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, FOLLOW_HEAD.length).setValues(rows);
  sh.getRange('G1:H1').setValues([['อัปเดตล่าสุด', now_()]]);
}

/* ร่างสรุปยอดรุ่งเรือง: ข้อความในกลุ่มตั้งแต่วันถัดจากวันตัดยอดเดือนก่อน ถึงวันนี้ → รูปแบบที่คุณอ้อยพิมพ์เอง */
function draftRrlSummary_(ss, today) {
  const v = ss.getSheetByName(TAB_TEXT).getDataRange().getDisplayValues();
  const prevEnd = new Date(ymdToUtc_(today.slice(0, 8) + '01') - 86400000);           // วันสุดท้ายของเดือนก่อน
  const prevCut = Utilities.formatDate(new Date(prevEnd.getTime() - 3 * 86400000), 'UTC', 'yyyy-MM-dd');
  const lines = [];
  for (let i = 1; i < v.length; i++) if (v[i][2] === 'RRL' && v[i][0].slice(0, 10) > prevCut && v[i][0].slice(0, 10) <= today) lines.push(v[i][0] + ' | ' + v[i][3].slice(-6) + ' | ' + v[i][4]);
  if (!lines.length) return '';
  const prompt = 'Below is a LINE group chat log between a tire shop (buyer) and supplier รุ่งเรืองล้อแม็ค. Each line: time | sender id | text. ' +
    'List ONLY items the buyer actually ordered AND that were confirmed delivered or picked up (e.g. supplier says จัดส่งเรียบร้อย, buyer says รับแล้ว/ไปรับ). ' +
    'Ignore stock questions (มีไหม), items answered ไม่มี/หมด, and cancelled items. ' +
    'Return ONLY JSON: {"lines":["D/M/YY ยี่ห้อ ขนาด จำนวน", ...], "unsure":["short Thai note about anything ambiguous", ...]} ' +
    'using Thai Buddhist 2-digit year (2026 → 69), e.g. "6/11/69 ฟอเท็ก 265/60-18 4เส้น". Keep product wording as the buyer wrote it.\n\n' + lines.join('\n');
  const d = geminiJson_([{ text: prompt }]);
  const mm = +today.slice(5, 7);
  let out = 'ยอดเดือน ' + mm + '\n' + (d.lines || []).join('\n');
  if ((d.unsure || []).length) out += '\n\n(บอทไม่แน่ใจ: ' + d.unsure.join(' / ') + ')';
  return out;
}

/* แจ้งเตือนเรื่องที่คนต้องรู้ → push เข้าแชทส่วนตัวของคนที่ติ๊ก "รับแจ้งเตือน" ในแท็บ บอท-ตั้งค่า (ไม่ส่งเข้ากลุ่มเด็ดขาด)
 * นับโควต้า 1 ข้อความต่อผู้รับ → รวมหลายไฟล์เป็นข้อความเดียว และ throttleKey กันส่งเรื่องเดิมรัว ๆ (10 นาที) */
function alertAdmins_(ss, text, throttleKey) {
  try {
    if (throttleKey) {
      const cache = CacheService.getScriptCache();
      if (cache.get('alert_' + throttleKey)) return;
      cache.put('alert_' + throttleKey, '1', 600);
    }
    const cfg = readCfg_(ss);
    for (const id in cfg) if (cfg[id].alert && cfg[id].type === 'user') { try { pushText_(id, text); } catch (e) { console.error('alert ' + e); } }
  } catch (err) { console.error('alertAdmins ' + err); }
}

/* push ได้เฉพาะ userId (แชท 1:1) — ห้ามส่งเข้ากลุ่ม */
function pushText_(to, text) {
  if (!/^U[0-9a-f]{32}$/.test(String(to))) throw new Error('ส่งได้เฉพาะ userId');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') }, payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }), muteHttpExceptions: true });
}

/* =====================================================================
 * ส่วนที่ 5 — ติดตั้ง / ทดสอบ (กดรันใน editor)
 * ===================================================================== */
function setup() {
  const ss = ss_();
  const mk = function (name, head, textCols) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    (textCols || []).forEach(function (c) { sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@'); });   // วันที่/เลขเอกสารเก็บเป็นข้อความ กันชีทแปลงค่าเอง
    return sh;
  };
  mk(TAB_CFG, CFG_HEAD, [1]);
  mk(TAB_QUEUE, QUEUE_HEAD, [1, 6, 7, 11, 12, 13]);
  mk(TAB_TEXT, TEXT_HEAD, [1, 5]);
  mk(TAB_BILL, BILL_HEAD, [1, 3, 4, 9, 10, 11, 12]);
  mk(TAB_FOLLOW, FOLLOW_HEAD, [1]);
  getOrCreate_(DriveApp.getFolderById(FOLDER_ID), INBOX_NAME);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['processQueue', 'dailyJob'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(8).nearMinute(30).inTimezone(TZ).everyDays(1).create();
  Logger.log('ติดตั้งเสร็จ: แท็บ 5 แท็บ + ตั้งเวลา processQueue (5 นาที) และ dailyJob (08:30)');
}
function testConfig() {
  ['LINE_TOKEN', 'WEBHOOK_KEY', 'GEMINI_API_KEY', 'OI_USER_ID'].forEach(function (k) { Logger.log(k + ': ' + (prop_(k) ? 'มี' : 'ยังไม่ได้ใส่')); });
}
function testGemini() { Logger.log(JSON.stringify(geminiJson_([{ text: 'Return ONLY JSON {"ok":true}' }]))); }
function testFollowups() { Logger.log(JSON.stringify(buildFollowups_(readBills_(ss_()), today_(), ''), null, 1)); }
/* อ่านไฟล์ที่วางไว้ใน Drive เอง (เช่น สแกนตัวจริง): ใส่ fileId แล้วรัน — เข้าคิวเหมือนไฟล์จากไลน์ */
function enqueueDriveFile(fileId, supplier) {
  appendRow_(ss_().getSheetByName(TAB_QUEUE), [now_(), 'Drive', supplier || 'AUTO', '', 'file', '', fileId, 'NEW', '', '', '', '', '', '', '', '', '', 0, '']);
}
