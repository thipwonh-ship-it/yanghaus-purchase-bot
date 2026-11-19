// ทดสอบตรรกะล้วนของ Code.gs (ไม่เรียก Google/LINE): node test/run.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.T={normDocNo_,applyDoc_,buildFollowups_,billStatus_,docKind_,detectSupplier_,lastDay_,num_,ackText_,ackMode_};', ctx);
const T = ctx.T;
let fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL', m, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } else console.log('ok  ', m); };

// ---- เลขเอกสาร ----
eq(T.normDocNo_('TVO1691100119'), 'IV01691100119', 'OCR TVO1 → IV01');
eq(T.normDocNo_('IV 691100001'), 'IV691100001', 'ตัดช่องว่าง');
eq(T.normDocNo_('IV6910-00021'), 'IV6910-00021', 'คงขีด');
eq(T.docKind_({ title: 'ใบส่งสินค้า/ใบกำกับภาษี', doc_type: 'delivery_note', vat: 98.13 }), 'tax_invoice', 'หัวมีคำว่ากำกับ + VAT = ใบกำกับ');
eq(T.docKind_({ title: 'ใบส่งสินค้า', doc_type: 'tax_invoice', vat: 0 }), 'delivery_note', 'ใบส่งสินค้า VAT 0 = ใบส่งสินค้า');
eq(T.detectSupplier_({ payee: 'บจก. ป.รุ่งโรจน์ แม็กยางกระทุ่มแบน' }), 'PRR', 'สลิป → ป.รุ่งโรจน์');
eq(T.detectSupplier_({ seller: 'บริษัท ป.รุ่งเรืองล้อแม็กซ์ไทร์ จำกัด' }), 'RRL', 'รุ่งเรือง');
eq(T.detectSupplier_({ seller: 'บริษัท เจ สตาร์แม็กซ์ จำกัด', seller_tax_id: '0105556095450' }), 'JSTAR', 'เจสตาร์');

// ---- เจสตาร์ พ.ย. 2026 (ข้อมูลจริงจากเอกสาร) ----
const bills = [];
const rep = (date, lines) => T.applyDoc_(bills, { title: 'รายงานลูกหนี้ภาระบิลค้างชำระ', doc_type: 'outstanding_report', doc_date: date, customer_code: 'C-P124',
  lines: lines.map(l => ({ doc_no: l[1], doc_date: l[0], amount: l[2], paid: 0 })) }, 'JSTAR', '');
const rcpt = (no, date, lines) => T.applyDoc_(bills, { title: 'ใบเสร็จรับเงิน', doc_type: 'receipt', doc_no: no, doc_date: date, customer_code: 'C-P124',
  lines: lines.map(l => ({ doc_no: l[1], doc_date: l[0], amount: l[2], paid: l[3] === undefined ? l[2] : l[3] })) }, 'JSTAR', '');
const dn = (no, date, total) => T.applyDoc_(bills, { title: 'ใบส่งสินค้า', doc_type: 'delivery_note', doc_no: no, doc_date: date, total, vat: 0, customer_code: 'C-P124' }, 'JSTAR', 'dn:' + no);
const inv = (no, date, ref, total, vat) => T.applyDoc_(bills, { title: 'ใบส่งสินค้า/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: no, doc_date: date, ref_no: ref, total, vat, customer_code: 'C-P124', seller_tax_id: '0105556095450' }, 'JSTAR', 'inv:' + no);

const A = [['2026-11-01','IV691100001',14250],['2026-11-01','IVO1691100015',3525],['2026-11-02','IV03691100028',7500],['2026-11-03','IV01691100030',4000],['2026-11-03','IV01691100032',1500]];
const B = [['2026-11-04','IV691100042',22000],['2026-11-04','IV691100043',8000],['2026-11-04','IV01691100035',1500],['2026-11-04','TV01691100040',4050],['2026-11-05','IV691100067',20000],['2026-11-05','TV01691100052',6950],['2026-11-06','IV04691100043',4000]];
const C = [['2026-11-08','IV01691100079',6400],['2026-11-08','IV08691100059',9350],['2026-11-08','IV10691100050',8500]];
const D = [['2026-11-12','TVO1691100119',8250],['2026-11-12','IV01691100120',1500],['2026-11-13','IV691100211',24600],['2026-11-13','IV691100214',9800],['2026-11-13','IV01691100136',2000]];
const E = [['2026-11-15','IV01691100155',6900],['2026-11-16','IV08691100119',17500],['2026-11-16','IV03691100184',7200],['2026-11-17','IV01691100164',9000]];
rep('2026-11-08', A.concat(B));
dn('IV691100001', '2026-11-01', 14250);
rcpt('RV01691100072', '2026-11-08', A);
rep('2026-11-09', B.concat(C));
rcpt('RV691100062', '2026-11-09', B.concat([['2026-11-08','IV01691100079',6400,1000]]));
rcpt('RV691100062', '2026-11-09', B.concat([['2026-11-08','IV01691100079',6400,1000]]));   // ส่งซ้ำ ต้องไม่นับเบิ้ล
dn('IV691100135', '2026-11-10', 60625);
rcpt('RV691100135', '2026-11-13', [['2026-11-10','IV691100135',60625]]);
rep('2026-11-18', D.concat(E));
rcpt('RV691100172', '2026-11-18', D);
dn('IV04691100102', '2026-11-18', 29300);
eq(T.applyDoc_(bills, { title: 'ใบเสร็จรับเงิน', doc_type: 'receipt', doc_no: 'RV691100119', customer_code: 'NE-P023', lines: [{ doc_no: 'IV691100193', amount: 42000, paid: 42000 }] }, 'JSTAR', ''), 'ข้าม: เอกสารของลูกค้ารหัส NE-P023', 'ใบเสร็จของลูกค้ารายอื่นถูกข้าม');
// ใบกำกับ 12 ใบที่สแกน 19 พ.ย.
[['IV691100044','2026-11-04','IV01691100035',1500,98.13],['IV691100045','2026-11-04','IV01691100040',4050,264.95],['IV691100046','2026-11-04','IV691100042',22000,1439.25],
 ['IV691100047','2026-11-04','IV691100043',8000,523.36],['IV691100054','2026-11-05','IV691100001',14250.01,932.24],['IV691100056','2026-11-05','IV03691100028',7500,490.65],
 ['IV691100065','2026-11-05','IV01691100052',6950,454.67],['IV691100067','2026-11-06','IV04691100043',4000,261.68],['IV691100057','2026-11-05','IV01691100030',4000,261.68],
 ['IV691100058','2026-11-05','IV01691100032',1500,98.13],['IV691100062','2026-11-05','IV691100067',20000,1308.41],['IV691100055','2026-11-05','IV01691100015',3525,230.61]]
  .forEach(r => inv(...r));

eq(dn('IVCM691100006', '2026-11-04', 1000), 'ข้าม: ยางเคลม/รับคืน IVCM691100006', 'ยางเคลม IVCM ไม่ลงทะเบียน');
rep('2026-11-13', [['2026-11-04','IVCM691100006',1000]]);
const j = bills.filter(b => b.supplier === 'JSTAR');
const sum = a => Math.round(a.reduce((s, b) => s + b.amount, 0) * 100) / 100;
eq(j.length, 26, 'เจสตาร์ 26 บิล');
eq(sum(j), 298200, 'ยอดรวม 298,200');
const done = j.filter(b => b.invNo), pend = j.filter(b => !b.invNo);
eq([done.length, sum(done)], [12, 97275], 'ได้ใบกำกับ 12 บิล 97,275');
eq([pend.length, sum(pend)], [14, 200925], 'ค้าง 14 บิล 200,925');
eq(j.filter(b => b.review).map(b => b.key + ':' + b.review), [], 'ไม่มีรอตรวจ (ยอดต่าง 0.01 ไม่ถือว่าผิด)');
const b79 = j.find(b => b.no === 'IV01691100079');
eq([b79.paid, b79.payRef], [1000, 'RV691100062'], 'จ่ายบางส่วน 1,000 และใบเสร็จซ้ำไม่นับเบิ้ล');
const b67 = j.find(b => b.no === 'IV691100067');
eq([b67.invNo, j.find(b => b.no === 'IV04691100043').invNo], ['IV691100062', 'IV691100067'], 'เลขใบกำกับซ้ำกับเลขใบส่งสินค้า ไม่สับสน');
eq(T.billStatus_(b67), 'รอตัวจริง', 'สถานะ รอตัวจริง');
inv('IV691100999', '2026-11-20', 'IV691100135', 60000, 3925.23);
eq(/ไม่ตรงยอดบิล/.test(j.find(b => b.no === 'IV691100135').review), true, 'ยอดใบกำกับไม่ตรง → รอตรวจ');
j.find(b => b.no === 'IV691100135').review = ''; j.find(b => b.no === 'IV691100135').invNo = '';

// ---- กติกาทวงเจสตาร์ ----
const types = (d, rep) => T.buildFollowups_(bills, d, rep).map(r => r[1] + ':' + r[2]);
eq(types('2026-11-19', '2026-11-18'), [], 'พฤหัส 19 พ.ย. ไม่มีรายการ');
eq(types('2026-11-23', '2026-11-18'), ['เจสตาร์:ทวง (รายสัปดาห์)'], 'จันทร์ 23 พ.ย. ทวงรายสัปดาห์');
eq(T.buildFollowups_(bills, '2026-11-23', '')[0][3], 'บิลยังไม่มีใบกำกับ 14 บิล 200,925 บาท', 'รายละเอียดทวง 14 บิล');
eq(types('2026-11-25', '2026-11-18'), ['เจสตาร์:ขอรายงานบิลค้าง'], 'วันที่ 25 ขอรายงานบิลค้าง');
eq(types('2026-11-26', '2026-11-25'), [], 'ได้รายงานวันที่ 25 แล้ว ไม่ขึ้นซ้ำ');
dn('IV691100400', '2026-11-28', 5000);
eq(types('2026-11-28', '2026-11-25'), ['เจสตาร์:เสี่ยงข้ามเดือน', 'รุ่งเรือง:ยังไม่โอน'], '28 พ.ย. บิลปลายเดือนเสี่ยงข้ามเดือน + รุ่งเรืองยังไม่โอน');
eq(types('2026-11-27', '2026-11-25'), ['รุ่งเรือง:ตัดยอด'], '27 พ.ย. (เดือน 30 วัน) วันตัดยอดรุ่งเรือง');
eq(T.buildFollowups_([], '2026-12-28', '2026-12-26').map(r => r[2]), ['ตัดยอด'], '28 ธ.ค. (เดือน 31 วัน) วันตัดยอดรุ่งเรือง');
eq(types('2026-11-30', '2026-11-25').slice(0, 2), ['เจสตาร์:ทวง (สิ้นเดือน)', 'เจสตาร์:เสี่ยงข้ามเดือน'], '30 พ.ย. ทวงสิ้นเดือน');
eq(types('2026-12-03', '').filter(t => /ค้างจากเดือนก่อน/.test(t)).length, 1, '3 ธ.ค. เตือนบิลเดือนก่อน');

// ---- ป.รุ่งโรจน์ ----
const p = [];
T.applyDoc_(p, { title: 'ใบเสนอราคา', doc_type: 'quotation', doc_no: 'QT6911-00161', doc_date: '2026-11-08', total: 18200 }, 'PRR', 'qt');
eq(T.applyDoc_(p, { doc_type: 'transfer_slip', doc_no: 'TRBS261108119439655', doc_date: '2026-11-08', total: 18200, payee: 'บจก. ป.รุ่งโรจน์ แม็กยางกระทุ่มแบน' }, 'PRR', ''), 'จ่าย 18,200 → QT6911-00161', 'สลิปจับคู่ใบเสนอราคาด้วยยอด');
eq(T.buildFollowups_(p, '2026-11-09', '').length, 0, 'ครบ 1 วัน ยังไม่ทวง');
eq(T.buildFollowups_(p, '2026-11-10', '').map(r => r[2]), ['ทวง'], 'ครบ 2 วัน ทวง');
eq(T.buildFollowups_(p, '2026-11-11', '').length, 0, 'วันที่ 3 เว้น');
eq(T.buildFollowups_(p, '2026-11-12', '').map(r => r[2]), ['ทวง'], 'วันที่ 4 ทวงซ้ำ');
eq(T.applyDoc_(p, { title: 'ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'IV6911-00030', doc_date: '2026-11-08', total: 18200, vat: 1190.65 }, 'PRR', 'inv'), 'จับคู่บิล QT6911-00161', 'ชุด PDF ใบกำกับจับคู่ด้วยยอด');
eq(T.applyDoc_(p, { title: 'สำเนาใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'IV6911-00030', doc_date: '2026-11-08', total: 18200, vat: 1190.65 }, 'PRR', 'inv2'), 'ซ้ำ: ใบกำกับ IV6911-00030 ลงแล้ว', 'สำเนาส่งซ้ำไม่ลงเบิ้ล');
eq(T.buildFollowups_(p, '2026-11-12', '').length, 0, 'ได้ใบกำกับแล้ว เลิกทวง');
eq(p.length, 1, 'ป.รุ่งโรจน์ มีบิลเดียว');

// ---- รุ่งเรือง ----
const r = [];
T.applyDoc_(r, { doc_type: 'transfer_slip', doc_no: 'TRX1', doc_date: '2026-11-06', total: 30900, payee: 'บจก. ป.รุ่งเรืองล้อแม็กซ์ไทร์' }, 'RRL', '');
eq(T.buildFollowups_(r, '2026-11-08', '').map(x => x[2]), ['ทวง'], 'รุ่งเรือง: โอนแล้ว 2 วัน ทวงใบกำกับ');
T.applyDoc_(r, { title: 'บิลเงินสด/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'HS6911-06002', doc_date: '2026-11-06', total: 30900, vat: 2021.5 }, 'RRL', 'x');
eq([r.length, r[0].invNo, r[0].review], [1, 'HS6911-06002', ''], 'รุ่งเรือง: ใบกำกับตรงยอดโอน');
const r2 = [];
T.applyDoc_(r2, { doc_type: 'transfer_slip', doc_no: 'TRX2', doc_date: '2026-11-28', total: 40000 }, 'RRL', '');
T.applyDoc_(r2, { title: 'บิลเงินสด/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'HS6912-00001', doc_date: '2026-12-01', total: 39000, vat: 2551.4 }, 'RRL', 'x');
eq(/ไม่ตรง/.test(r2[0].review), true, 'รุ่งเรือง: ยอดใบกำกับไม่ตรงยอดโอน → รอตรวจ');

/* ข้อความตอบรับในแชท */
eq(T.ackText_({ status: 'DONE', kind: 'tax_invoice', supplierName: 'เจสตาร์', no: 'IV02691100045', total: 12400, result: 'จับคู่แล้ว' }),
  '✅ เก็บแล้ว: ใบกำกับภาษี เจสตาร์\nIV02691100045 · 12,400 บาท\nจับคู่แล้ว', 'ตอบรับ: อ่านสำเร็จ');
eq(/กำลังอ่าน/.test(T.ackText_(undefined)), true, 'ตอบรับ: ยังไม่ได้อ่าน');
eq(/ไม่ใช่เอกสาร/.test(T.ackText_({ status: 'SKIP' })), true, 'ตอบรับ: ไม่ใช่เอกสาร');
eq(T.ackText_({ status: 'DONE', kind: 'tax_invoice', supplierName: 'เจสตาร์', no: 'IV02691100045', total: 12400, result: 'จับคู่แล้ว' }, 'key'),
  '✅ เก็บใบกำกับภาษีแล้ว · IV02691100045 · 12,400 บาท', 'ตอบรับกลุ่มซัพฯ: ใบกำกับ บรรทัดเดียว');
eq([T.ackText_(undefined, 'key'), T.ackText_({ status: 'DONE', kind: 'transfer_slip', no: 'X', total: 5 }, 'key'), T.ackText_({ status: 'SKIP' }, 'key')], ['', '', ''], 'ตอบรับกลุ่มซัพฯ: กรณีอื่นเงียบ');
eq([T.ackMode_('ไม่ตอบ'), T.ackMode_(''), T.ackMode_('เฉพาะเอกสารสำคัญ'), T.ackMode_('ทุกไฟล์'), T.ackMode_(true)], ['', '', 'key', 'all', 'all'], 'โหมดตอบรับ');

console.log(fail ? '\n' + fail + ' รายการไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
