// ทดสอบตรรกะล้วนของ Code.gs (ไม่เรียก Google/LINE): node test/run.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.T={normDocNo_,applyDoc_,buildFollowups_,billStatus_,docKind_,detectSupplier_,lastDay_,num_,ackSummary_,ackMode_,editDist_,docKind_,isCopy_,normDate_};', ctx);
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
eq(types('2026-11-28', '2026-11-25'), ['เจสตาร์:เสี่ยงข้ามเดือน'], '28 พ.ย. บิลปลายเดือนเสี่ยงข้ามเดือน (รุ่งเรืองไม่มีรายการก่อนสิ้นเดือน)');
eq(types('2026-11-27', '2026-11-25'), [], '27 พ.ย. ไม่ใช่วันตัดยอดรุ่งเรืองแล้ว');
eq(T.buildFollowups_([], '2026-12-28', '2026-12-26').map(r => r[2]), [], '28 ธ.ค. ไม่ใช่วันตัดยอดรุ่งเรืองแล้ว');
eq(T.buildFollowups_([], '2026-12-31', '2026-12-26').map(r => r[2]), ['สรุปยอดสิ้นเดือน'], '31 ธ.ค. รุ่งเรืองสรุปยอดวันสิ้นเดือน');
eq(types('2026-11-30', '2026-11-25'), ['เจสตาร์:ทวง (สิ้นเดือน)', 'เจสตาร์:เสี่ยงข้ามเดือน', 'รุ่งเรือง:สรุปยอดสิ้นเดือน'], '30 พ.ย. ทวงสิ้นเดือน + รุ่งเรืองสรุปยอด');
eq(T.buildFollowups_([], '2026-12-02', '').map(r => r[2]), ['ยังไม่โอน'], '2 ธ.ค. รุ่งเรืองยอด พ.ย. ยังไม่โอน');
eq(T.buildFollowups_([], '2026-12-03', '').map(r => r[2]), [], '3 ธ.ค. (วันคี่) ไม่เตือนซ้ำ');
eq(T.buildFollowups_([], '2026-12-12', '').map(r => r[2]), [], '12 ธ.ค. เลิกเตือนยังไม่โอน');
eq(types('2026-12-03', '').filter(t => /ค้างจากเดือนก่อน/.test(t)).length, 1, '3 ธ.ค. เตือนบิลเดือนก่อน');

// ---- ป.รุ่งโรจน์ ----
const p = [];
T.applyDoc_(p, { title: 'ใบเสนอราคา', doc_type: 'quotation', doc_no: 'QT6911-00161', doc_date: '2026-11-08', total: 18200 }, 'PRR', 'qt');
eq(T.applyDoc_(p, { doc_type: 'transfer_slip', doc_no: 'TRBS261108119439655', doc_date: '2026-11-08', total: 18200, payee: 'บจก. ป.รุ่งโรจน์ แม็กยางกระทุ่มแบน' }, 'PRR', ''), 'จ่าย 18,200 → QT6911-00161', 'สลิปจับคู่ใบเสนอราคาด้วยยอด');
eq(T.buildFollowups_(p, '2026-11-09', '').length, 0, 'ครบ 1 วัน ยังไม่ทวง');
eq(T.buildFollowups_(p, '2026-11-10', '').filter(r => r[1] === 'ป.รุ่งโรจน์').map(r => r[2]), ['ทวง'], 'ครบ 2 วัน ทวง');
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
eq([r[0].key, r[0].no, r[0].date, T.billStatus_(r[0])], ['RRL|2026-10', 'ยอดเดือน 2026-10', '2026-10-31', 'รอตัวจริง'], 'รุ่งเรือง: โอนต้นเดือน = ยอดเดือนก่อน และใบกำกับเดือนถัดไปไม่ขึ้นว่าข้ามเดือน');
eq(T.buildFollowups_(r, '2026-11-02', '').map(x => x[2]), [], 'รุ่งเรือง: ได้ใบกำกับแล้ว ไม่ขึ้นค้างจากเดือนก่อน');
const r2 = [];
T.applyDoc_(r2, { doc_type: 'transfer_slip', doc_no: 'TRX2', doc_date: '2026-11-28', total: 40000 }, 'RRL', '');
T.applyDoc_(r2, { title: 'บิลเงินสด/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'HS6912-00001', doc_date: '2026-12-01', total: 39000, vat: 2551.4 }, 'RRL', 'x');
eq(/ไม่ตรง/.test(r2[0].review), true, 'รุ่งเรือง: ยอดใบกำกับไม่ตรงยอดโอน → รอตรวจ');
eq([r2.length, r2[0].key], [1, 'RRL|2026-11'], 'รุ่งเรือง: โอนสิ้นเดือน = ยอดเดือนนั้น ใบกำกับ ธ.ค. จับคู่บิลเดียวกัน');
const r3 = [];
T.applyDoc_(r3, { doc_type: 'transfer_slip', doc_no: 'TRX3', doc_date: '2026-11-30', total: 5000 }, 'RRL', '');
eq(T.buildFollowups_(r3, '2026-12-01', '').filter(x => /ค้างจากเดือนก่อน/.test(x[2])).length, 0, 'รุ่งเรือง: ยอด พ.ย. รอใบกำกับ ธ.ค. ไม่นับเป็นค้างก่อนปิดยอด');
eq(T.buildFollowups_(r3, '2026-12-02', '').map(x => x[2]), ['ทวง'], 'รุ่งเรือง: โอนสิ้นเดือนครบ 2 วัน ทวงใบกำกับ (ไม่ขึ้นยังไม่โอน)');
T.applyDoc_(r3, { doc_type: 'transfer_slip', doc_no: 'TRX4', doc_date: '2026-12-03', total: 700 }, 'RRL', '');
eq(r3.map(b => b.key + ':' + b.paid), ['RRL|2026-11:5000', 'RRL|2026-12:700'], 'รุ่งเรือง: เดือนก่อนเคลียร์ตั้งแต่สิ้นเดือนแล้ว สลิปต้นเดือน = เดือนใหม่');
const r4 = [];
T.applyDoc_(r4, { doc_type: 'transfer_slip', doc_no: 'TRX5', doc_date: '2026-12-01', total: 1000 }, 'RRL', '');
T.applyDoc_(r4, { doc_type: 'transfer_slip', doc_no: 'TRX6', doc_date: '2026-12-02', total: 2000 }, 'RRL', '');
eq(r4.map(b => b.key + ':' + b.paid), ['RRL|2026-11:3000'], 'รุ่งเรือง: โอน 2 ครั้งต้นเดือน รวมเป็นยอดเดือนก่อน');
const r5 = [];
T.applyDoc_(r5, { title: 'บิลเงินสด/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'HS7001-00001', doc_date: '2027-01-04', total: 900, vat: 58.88 }, 'RRL', 'x');
eq([r5[0].key, r5[0].date], ['RRL|2026-12', '2026-12-31'], 'รุ่งเรือง: ใบกำกับ ม.ค. ที่ยังไม่เห็นสลิป = ยอดเดือน ธ.ค. ปีก่อน');

/* ข้อความตอบรับในแชท — รวมเป็นข้อความเดียว ไม่แจ้งยอดเงิน */
const AK = (kind, no, result) => ({ status: 'DONE', kind, no, result: result || '' });
eq(T.ackSummary_([AK('tax_invoice', 'IV1'), AK('tax_invoice', 'IV2'), AK('tax_invoice', 'IV3'), AK('tax_invoice', 'IV4'), AK('tax_invoice', 'IV5')], 'key'),
  '✅ เก็บใบกำกับภาษีแล้ว 5 ใบ: IV1, IV2, IV3, IV4, IV5\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ตอบรับ: ใบกำกับ 5 ใบ ข้อความเดียว');
eq(T.ackSummary_([AK('tax_invoice', 'IV1')], 'key'), '✅ เก็บใบกำกับภาษีแล้ว: IV1\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ตอบรับ: ใบเดียว');
eq(T.ackSummary_([AK('delivery_note', 'DN1'), AK('tax_invoice', 'IV1', 'ซ้ำ: เคยลงแล้ว'), AK('transfer_slip', 'X'), { status: 'SKIP' }, { status: 'NEW' }], 'key'),
  '✅ เก็บใบกำกับภาษีแล้ว: IV1 (ซ้ำ)\n📥 อีก 1 ไฟล์รับแล้ว กำลังอ่านต่อ\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ตอบรับกลุ่มซัพฯ: คละชนิด + บอกจำนวนที่ยังอ่านไม่เสร็จ');
eq(T.ackSummary_([AK('transfer_slip', 'X'), { status: 'SKIP' }, { status: 'NEW' }], 'key'), '', 'ตอบรับกลุ่มซัพฯ: ไม่มีเอกสารสำคัญ = เงียบ');
eq(T.ackSummary_([AK('transfer_slip', 'X'), { status: 'SKIP' }, { status: 'ERR' }], 'all'),
  '✅ เก็บสลิปโอนแล้ว: X\nℹ️ ไม่ใช่เอกสาร 1 ไฟล์ (ไม่ได้เก็บ)\n📥 อีก 1 ไฟล์รับแล้ว กำลังอ่านต่อ\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ตอบรับทุกไฟล์');
eq([T.ackMode_('ไม่ตอบ'), T.ackMode_(''), T.ackMode_('เฉพาะเอกสารสำคัญ'), T.ackMode_('ทุกไฟล์'), T.ackMode_(true)], ['', '', 'key', 'all', 'all'], 'โหมดตอบรับ');
eq([T.normDocNo_('IV69110013S'), T.normDocNo_('IVO1691100119'), T.normDocNo_('IVCM691100006'), T.normDocNo_('HS6911-06002')], ['IV691100135', 'IV01691100119', 'IVCM691100006', 'HS6911-06002'], 'เลขเอกสาร: แก้ OCR S→5 เฉพาะเลขเจสตาร์');

{
/* เจสตาร์: รูปในแชทอ่านเลขผิด → จับคู่ด้วยเลขใกล้เคียง/ยอด (เคสจริง 19 พ.ย.) */
const fz = [];
const fdn = (no, date, total) => T.applyDoc_(fz, { title: 'ใบส่งสินค้า', doc_type: 'delivery_note', doc_no: no, doc_date: date, total: total, vat: 0, customer_code: 'C-P124' }, 'JSTAR', '');
const fiv = (no, date, ref, total) => T.applyDoc_(fz, { title: 'ใบส่งสินค้า/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: no, doc_date: date, ref_no: ref, total: total, vat: 1 }, 'JSTAR', 'L');
fdn('IV01691100079', '2026-11-08', 6400); fdn('IV08691100059', '2026-11-08', 9350); fdn('IV10691100050', '2026-11-08', 8500);
fdn('IV691100135', '2026-11-10', 60625); fdn('IV691100211', '2026-11-13', 24600);
const fbill = no => fz.filter(b => b.no === no)[0];
fiv('IV691100082', '2026-11-08', 'IV691100079', 6400);
eq([fbill('IV01691100079').invNo, fbill('IV01691100079').review], ['IV691100082', ''], 'เลขอ้างอิงตกรหัสสาขา 2 หลัก + ยอดตรง → จับคู่ ไม่ต้องตรวจ');
fiv('IV691100083', '2026-11-08', 'IV691100079', 9350);
eq([fbill('IV08691100059').invNo, /จับคู่จากยอด/.test(fbill('IV08691100059').review), fbill('IV01691100079').review], ['IV691100083', true, ''], 'เลขอ้างอิงผิดทั้งเลข → จับจากยอด+วันที่ ขึ้นรอตรวจ ไม่ไปทับบิลอื่น');
fiv('IV691100085', '2026-11-08', 'IV1069110050', 8500.01);
eq([fbill('IV10691100050').invNo, fbill('IV10691100050').review], ['IV691100085', ''], 'เลขอ้างอิงตก 0 หนึ่งตัว → จับคู่');
fiv('IV69110013S', '2026-11-13', 'IV69110021', 24600);
eq([fbill('IV691100211').invNo, fbill('IV691100211').review], ['IV691100135', ''], 'เลขอ้างอิงขาด 1 หลัก + เลขใบกำกับ S→5');
fiv('IV691100100', '2026-11-10', 'IV691100135', 54425);
eq([fbill('IV691100135').invNo, /ไม่ตรงยอดบิล/.test(fbill('IV691100135').review)], ['IV691100100', true], 'เลขตรงแต่ยอดไม่ตรง → จับคู่ + รอตรวจยอด');
eq(fz.length, 5, 'ไม่มีบิลผีเกิดจากเลขที่อ่านผิด');
fiv('IV691100082', '2026-11-09', 'IV07691100999', 1234);
eq(/ซ้ำกับบิล/.test(fbill('IV07691100999').review), true, 'เลขใบกำกับซ้ำกับบิลอื่น → รอตรวจ');
}
{
  const dd = [];
  T.applyDoc_(dd, { title: 'ใบส่งสินค้า', doc_type: 'delivery_note', doc_no: 'IV04691100102', doc_date: '2026-11-18', total: 29300, vat: 0 }, 'JSTAR', '');
  T.applyDoc_(dd, { title: 'ใบส่งสินค้า/ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: 'IV691100195', doc_date: '2026-11-15', ref_no: 'IV04691100102', total: 29300, vat: 1 }, 'JSTAR', 'L');
  eq(/อาจอ่านวันที่ผิด/.test(dd[0].review), true, 'วันที่ใบกำกับก่อนวันที่บิล → รอตรวจ');
}

/* ชุดเอกสาร ป.รุ่งโรจน์ (4 PDF เลขเดียวกัน มี VAT ทุกใบ) */
{
  const set = t => ({ title: t, doc_type: 'tax_invoice', doc_no: 'IV6910-00044', doc_date: '2026-10-26', total: 31600, vat: 2067.29 });
  eq([T.docKind_(set('ต้นฉบับใบกำกับภาษี')), T.docKind_(set('สำเนาใบกำกับภาษี')), T.docKind_(set('ใบเสร็จรับเงิน')), T.docKind_(set('ใบส่งสินค้า/ใบแจ้งหนี้')), T.docKind_(set('ใบเสร็จรับเงิน/ใบกำกับภาษี'))],
    ['tax_invoice', 'tax_invoice', 'receipt', 'delivery_note', 'tax_invoice'], 'ป.รุ่งโรจน์: แยกชนิดจากหัวเอกสาร');
  eq([T.isCopy_(set('สำเนาใบกำกับภาษี')), T.isCopy_(set('ต้นฉบับใบกำกับภาษี')), T.isCopy_(set('ใบกำกับภาษี'))], [true, false, false], 'สำเนา/ต้นฉบับ');
  const it = (kind, result, quiet) => ({ status: 'DONE', kind, no: 'IV6910-00044', result, quiet });
  eq(T.ackSummary_([it('tax_invoice', 'ซ้ำ: มีต้นฉบับแล้ว'), it('tax_invoice', 'ได้ต้นฉบับแล้ว (แทนใบเดิม)'), it('receipt', 'เก็บไฟล์ (receipt)', true), it('delivery_note', 'เก็บไฟล์')], 'key'),
    '✅ เก็บใบกำกับภาษีแล้ว: IV6910-00044\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ป.รุ่งโรจน์ ชุด 4 ไฟล์ → ตอบบรรทัดเดียว');
  eq(T.ackSummary_([it('tax_invoice', 'ใบกำกับใหม่ IV6910-00044 · สำเนา')], 'key'), '✅ เก็บใบกำกับภาษีแล้ว: IV6910-00044 (สำเนา)\n🙏 ยางเฮ้าส์ ขอบคุณค่ะ', 'ได้แค่สำเนา');
}

/* ตรวจโค้ดรอบ 19 พ.ย. ค่ำ */
eq([T.normDate_('2026-11-18'), T.normDate_('2569-11-18'), T.normDate_('18/11/2569'), T.normDate_('18/11/69'), T.normDate_('2026-13-40'), T.normDate_(''), T.normDate_('abc')],
  ['2026-11-18', '2026-11-18', '2026-11-18', '2026-11-18', '', '', ''], 'วันที่: แปลง พ.ศ./รูปแบบไทย · อ่านไม่ออก = ว่าง');
eq(T.docKind_({ title: 'ใบเสร็จรับเงิน e-slip', doc_type: 'transfer_slip', vat: 0 }), 'transfer_slip', 'สลิปที่หัวมีคำว่าใบเสร็จ ยังเป็นสลิป');
{
  const bb = [];
  T.applyDoc_(bb, { title: 'ใบเสนอราคา', doc_type: 'quotation', doc_no: 'QT1', doc_date: '2026-11-10', total: 5000, vat: 0 }, 'PRR', '');
  const r1 = T.applyDoc_(bb, { title: 'ใบกำกับภาษี', doc_type: 'tax_invoice', doc_no: '', doc_date: '2026-11-11', total: 5000, vat: 327.1 }, 'PRR', 'L');
  eq([/อ่านเลขใบกำกับไม่ได้/.test(r1), bb.length, bb[0].invNo, /อ่านเลขใบกำกับไม่ได้/.test(bb[1].review)], [true, 2, '', true], 'ใบกำกับอ่านเลขไม่ได้ → ไม่จับคู่กับบิลอื่น ขึ้นรอตรวจแยก');
  const slip = { title: 'โอนเงินสำเร็จ', doc_type: 'transfer_slip', doc_no: 'REF9', doc_date: '2026-11-10', total: 5000, vat: 0 };
  T.applyDoc_(bb, slip, 'PRR', '');
  const r2 = T.applyDoc_(bb, slip, 'PRR', '');
  eq([bb[0].paid, /^ซ้ำ/.test(r2), bb.length], [5000, true, 2], 'ป.รุ่งโรจน์: สลิปเดิมอ่านซ้ำ ไม่นับจ่ายสองครั้ง ไม่เกิดบิลใหม่');
  const rr = [];
  T.applyDoc_(rr, { title: 'โอนเงินสำเร็จ', doc_type: 'transfer_slip', doc_no: '', doc_date: '2026-11-27', total: 1000, vat: 0 }, 'RRL', '');
  T.applyDoc_(rr, { title: 'โอนเงินสำเร็จ', doc_type: 'transfer_slip', doc_no: '', doc_date: '2026-11-28', total: 2000, vat: 0 }, 'RRL', '');
  eq(rr[0].paid, 3000, 'รุ่งเรือง: สลิป 2 ใบที่อ่านเลขอ้างอิงไม่ได้ นับครบทั้งสองใบ');
}

console.log(fail ? '\n' + fail + ' รายการไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
