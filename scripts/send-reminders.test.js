'use strict';
// 執行方式：node scripts/send-reminders.test.js （不需要安裝任何套件、不會連線、不會寄信）
const assert = require('assert');
const r = require('./send-reminders.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✅ ' + name); };

console.log('\n【姓名與日期】');
t('Marvin(個別)、Marvin（團體）都是 Marvin', () => {
    assert.strictEqual(r.baseName('Marvin(個別)'), 'Marvin');
    assert.strictEqual(r.baseName('Marvin（團體）'), 'Marvin');
    assert.strictEqual(r.baseName('學生A'), '學生A');
    assert.strictEqual(r.baseName(' 小明 (個別)(團體) '), '小明');
});
t('「明天」用台北時間算：21:30 還是同一天，午夜過後是隔天', () => {
    assert.strictEqual(r.taipeiToday(new Date('2026-11-27T13:30:00Z')), '2026-11-27');   // 台北 21:30
    assert.strictEqual(r.taipeiToday(new Date('2026-11-27T16:30:00Z')), '2026-11-28');   // 台北 00:30
});
t('加一天：跨月、跨年都對', () => {
    assert.strictEqual(r.addDays('2026-11-30', 1), '2026-12-01');
    assert.strictEqual(r.addDays('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(r.addDays('2028-02-28', 1), '2028-02-29');
});
t('星期：2026/11/28 是週六、11/29 是週日', () => {
    assert.strictEqual(r.weekdayOf('2026-11-28'), 6);
    assert.strictEqual(r.weekdayOf('2026-11-29'), 0);
    assert.strictEqual(r.formatDateLabel('2026-11-28'), '11/28（六）');
    assert.strictEqual(r.formatDateLabel('2026-12-01'), '12/1（二）');
});

console.log('\n【這天有沒有課（規則與網站相同）】');
const weekly = { isRepeating: true, day: '7', date: '2026-11-07', exceptions: ['2026-11-21'], repeatEndDate: '2026-12-12' };   // 每週六
t('單次課只看日期', () => {
    assert.ok(r.occursOn({ date: '2026-11-28' }, '2026-11-28'));
    assert.ok(!r.occursOn({ date: '2026-11-28' }, '2026-11-29'));
});
t('每週重複：星期對、在開始日與結束日之間才有課', () => {
    assert.ok(r.occursOn(weekly, '2026-11-28'));
    assert.ok(!r.occursOn(weekly, '2026-11-27'), '星期不對');
    assert.ok(!r.occursOn(weekly, '2026-10-31'), '開始日之前');
    assert.ok(!r.occursOn(weekly, '2026-12-19'), '結束日之後');
    assert.ok(r.occursOn(weekly, '2026-12-12'), '結束日當天還有課');
});
t('用「只刪本週」取消的那天不會有課', () => assert.ok(!r.occursOn(weekly, '2026-11-21')));
t('週日（day 是 "8"）與沒有結束日的重複課', () => {
    const sun = { isRepeating: true, day: '8', date: '2026-11-01', exceptions: [] };
    assert.ok(r.occursOn(sun, '2026-11-29'));
    assert.ok(r.occursOn(sun, '2027-06-06'));
    assert.ok(!r.occursOn(sun, '2026-11-28'));
});
t('重複課沒有 day 欄位就當作沒課（不要亂寄）', () => assert.ok(!r.occursOn({ isRepeating: true, date: '2026-11-01' }, '2026-11-28')));

console.log('\n【該寄給誰】');
const ev = (o) => Object.assign({ type: 'work', isRepeating: false, exceptions: [], loc: '台大新體', start: '10:00', end: '11:00', date: '2026-11-28' }, o);
const students = { Marvin: { email: 'Marvin@Gmail.com' }, 小明: { email: '' }, 小華: { email: 'hua@x.com' }, 小美: { email: 'mei@x.com' } };
const approved = { 'marvin@gmail.com': { name: 'Marvin' }, 'hua@x.com': { name: '別人' } };
t('已綁定＋已核准 → 寄；Email 轉小寫；一天兩堂 → 各一封，依時間排序', () => {
    const p = r.planReminders({ students, approved, dateStr: '2026-11-28', events: [
        ev({ name: 'Marvin(團體)', studentBase: 'Marvin', start: '11:00', end: '13:00' }),
        ev({ name: 'Marvin(個別)', studentBase: 'Marvin' })
    ] });
    assert.strictEqual(p.items.length, 2);
    assert.deepStrictEqual(p.items.map((i) => i.lesson.name), ['Marvin(個別)', 'Marvin(團體)']);
    assert.ok(p.items.every((i) => i.email === 'marvin@gmail.com'));
});
t('沒有 studentBase 的舊課程，用名字括號前面那段找學生', () => {
    const p = r.planReminders({ students, approved, dateStr: '2026-11-28', events: [ev({ name: 'Marvin(個別)' })] });
    assert.strictEqual(p.items.length, 1);
});
t('略過的情況：沒 Email、核准的是別的姓名、沒核准、找不到學生', () => {
    const p = r.planReminders({ students, approved, dateStr: '2026-11-28', events: [
        ev({ name: '小明(個別)', start: '08:00' }), ev({ name: '小華(個別)', start: '09:00' }),
        ev({ name: '小美(個別)', start: '10:00' }), ev({ name: '路人(個別)', start: '11:00' })
    ] });
    assert.strictEqual(p.items.length, 0);
    assert.deepStrictEqual(p.skipped.map((s) => s.reason), ['還沒有綁定 Email', '尚未核准', '尚未核准', '找不到這位學生的資料']);
});
t('不是教球的行程、不是這天的課，都不會寄', () => {
    const p = r.planReminders({ students, approved, dateStr: '2026-11-28', events: [
        ev({ name: 'Marvin(個別)', type: 'school' }), ev({ name: 'Marvin(個別)', date: '2026-11-29' })
    ] });
    assert.strictEqual(p.lessons.length, 0);
});

console.log('\n【信件內容】');
const lesson = { name: 'Marvin(個別)', start: '10:00', end: '11:00', loc: '台大新體' };
t('標題與內文（跟你確認過的格式一致）', () => {
    const m = r.buildEmail({ base: 'Marvin', lesson, dateStr: '2026-11-28', isTomorrow: true, siteUrl: 'https://x.github.io/app/' });
    assert.strictEqual(m.subject, '【桌球課提醒】明天 11/28（六）10:00–11:00｜台大新體');
    assert.strictEqual(m.text, [
        'Marvin 您好，', '', '提醒您，明天有桌球課：', '',
        '  日期　11/28（六）', '  時間　10:00 – 11:00', '  地點　台大新體', '  課別　個別課', '',
        '如需請假或調整，請直接聯繫教練。', '查看課表與繳費：https://x.github.io/app/', '', '桌球教學管理系統'
    ].join('\n'));
});
t('團體課的課別；沒有括號就不顯示課別；沒填地點會註明', () => {
    assert.ok(r.buildEmail({ base: 'M', lesson: { ...lesson, name: 'M(團體)' }, dateStr: '2026-11-28', isTomorrow: true }).text.includes('課別　團體課'));
    assert.ok(!r.buildEmail({ base: 'M', lesson: { ...lesson, name: 'M' }, dateStr: '2026-11-28', isTomorrow: true }).text.includes('課別'));
    assert.ok(r.buildEmail({ base: 'M', lesson: { ...lesson, loc: '' }, dateStr: '2026-11-28', isTomorrow: true }).subject.includes('（未填寫地點）'));
});
t('手動指定其他日期時，不寫「明天」', () => {
    const m = r.buildEmail({ base: 'M', lesson, dateStr: '2026-12-05', isTomorrow: false });
    assert.ok(!m.subject.includes('明天') && !m.text.includes('明天'));
});
t('測試信會註明正式會寄給誰', () => {
    const m = r.buildEmail({ base: 'M', lesson, dateStr: '2026-11-28', isTomorrow: true, testNote: '（這是測試信，正式執行時會寄給：a@x.com）' });
    assert.ok(m.text.startsWith('（這是測試信，正式執行時會寄給：a@x.com）'));
});
t('寄給教練的摘要：試跑與正式的標題不同，並列出略過原因', () => {
    const plan = r.planReminders({ students, approved, dateStr: '2026-11-28', events: [ev({ name: 'Marvin(個別)', studentBase: 'Marvin' }), ev({ name: '小明(個別)', start: '12:00' })] });
    const dry = r.buildSummary({ dateStr: '2026-11-28', mode: 'dry-run', plan, sent: [], failed: [] });
    assert.ok(dry.subject.startsWith('【提醒試跑報告】') && dry.text.includes('marvin@gmail.com') && dry.text.includes('還沒有綁定 Email'));
    const real = r.buildSummary({ dateStr: '2026-11-28', mode: 'send', plan, sent: plan.items, failed: [{ ...plan.items[0], error: '連線逾時' }] });
    assert.ok(real.subject.startsWith('【提醒寄送摘要】') && real.text.includes('寄送失敗 1 封') && real.text.includes('連線逾時'));
});

console.log('\n【隱私】');
t('錯誤訊息裡的 Email 會被遮起來（公開的執行紀錄不能出現學生 Email）', () => {
    assert.strictEqual(r.scrub('Invalid recipient marvin@gmail.com, hua@x.com.tw'), 'Invalid recipient ***@***, ***@***');
});

console.log(`\n結果：${pass} 項通過、0 項失敗`);
