'use strict';
// 執行方式：node tests/effective-style.test.js
// 用 tests/css-engine.js 算出「元素最後實際套用到的樣式」（含祖先、權重、!important、繼承、手機／電腦寬度）。
// 它不會排版，所以實際高度要在手機上看；但「規則有沒有套到、有沒有被別條蓋掉」會在這裡被抓出來。
// 想拿舊版樣式做對照：CSS_FILE=舊檔案路徑 node tests/effective-style.test.js
const fs = require('fs');
const path = require('path');
const { load } = require('./css-engine.js');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(process.env.CSS_FILE || path.join(root, 'cal-gemini.css'), 'utf8');
const html = fs.readFileSync(process.env.HTML_FILE || path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const E = load({ css, html });
const M = { w: 390, h: 844 }, D = { w: 1200, h: 900 };   // 手機、電腦

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + '\n       ' + e.message.split('\n')[0]); } };
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what || ''}：期望「${b}」，實際「${a}」`); };
const same = (a, b, props, vp = M) => { const x = E.computed(a, vp), y = E.computed(b, vp); for (const p of props) eq(x[p], y[p], `${p}（贏的規則：${x.__by[p]}）`); };
const within = (n, id) => { for (let p = n; p; p = p.parent) if (p.id === id) return true; return false; };

const home = (id) => E.byId(id);
const SAME_FONT = ['font-size', 'font-weight', 'line-height', 'color', 'font-family'];

console.log('\n【首頁】');
t('「目前沒有公告時段」（沒有 class 的 <p>）跟「停課公告」內容同一種字體：16px、半粗、深色', () => {
    const p = E.addChild(home('student-slots-content'), { tag: 'p' });
    same(p, home('student-notice-content'), SAME_FONT);
    const c = E.computed(p); eq(c['font-size'], '16px'); eq(c['font-weight'], '600');
});
t('有時段時，每個時段的字體跟「下次上課」一模一樣：18px、半粗', () => {
    const chip = E.addChild(home('student-slots-content'), { tag: 'div', classes: ['slot-chip'] });
    same(chip, home('student-next-class'), SAME_FONT);
    eq(E.computed(chip)['font-size'], '18px');
});
t('問候用特別字體（Playfair Display 斜體＋Noto Serif TC），統計數字仍是黑體', () => {
    const greet = E.find((n) => n.classes.has('panel-subtitle') && within(n, 'panel-student-home'));
    const g = E.computed(greet), name = E.computed(home('student-name-display'));
    ok(/Playfair Display/.test(g['font-family']), '問候字體：' + g['font-family']); eq(g['font-style'], 'italic');
    ok(/Noto Serif TC/.test(name['font-family']), '姓名字體：' + name['font-family']);
    const stat = E.find((n) => n.id === 'student-total-hours');
    ok(/JhengHei/.test(E.computed(stat)['font-family']) && !/Serif/.test(E.computed(stat)['font-family']), '統計數字字體：' + E.computed(stat)['font-family']);
});

console.log('\n【學習歷程】');
t('「今年已上完累計 N 小時」整個拿掉了（網頁、程式、樣式裡都沒有）', () => {
    const calJs = fs.readFileSync(path.join(root, 'cal-gemini.js'), 'utf8');
    ok(!/chart-year-total/.test(html + calJs + css), '還有殘留的 chart-year-total');
    ok(!/今年已上完累計|全年已上完共/.test(html + calJs + css), '還有殘留的文字');
    ok(!E.byId('chart-year-total'), '網頁裡還有這個元素');
});

console.log('\n【日曆頁】');
t('手機：說明文字與月曆相隔 20px，沒有被撐開的空白', () => {
    const detail = E.computed(home('student-day-detail')), panel = E.computed(E.find((n) => n.classes.has('panel-inner') && within(n, 'panel-student-calendar')));
    eq(detail['margin-top'], '20px', 'margin-top'); eq(detail.height, 'auto', 'height');
    eq(panel['align-content'], 'start', 'align-content（沒有它，多出來的畫面高度會被分給每一列）'); eq(panel.gap, '0', 'gap');
    eq(E.computed(home('student-month-grid'))['margin-bottom'], '0', '月曆 margin-bottom');
});
t('電腦版的日曆頁沒有被動到（詳細資料區維持原本的固定高度）', () => {
    const d = E.computed(home('student-day-detail'), D); eq(d.height, '540px'); eq(d.position, 'sticky');
});

console.log('\n【繳費頁】');
const payTop = () => E.find((n) => n.classes.has('pay-card') && n.parent && n.parent.classes.has('panel-inner') && within(n, 'panel-student-pay'));
const methods = () => { const card = E.addChild(home('pay-method-area'), { classes: ['pay-card', 'pay-methods'] }); return card; };
t('上方卡片是白色，跟學習歷程卡片同樣的白底、細邊框、圓角', () => {
    const top = E.computed(payTop()), chart = E.computed(E.find((n) => n.classes.has('progress-chart-card')));
    eq(top.background, '#fff', 'background');
    for (const p of ['background', 'border', 'border-radius']) eq(top[p], chart[p], p);
});
t('「付款方式」卡片沒有框：透明底、沒邊框、沒陰影、沒內距；也沒有「付款方式」標題', () => {
    const c = E.computed(methods());
    eq(c.background, 'transparent', 'background'); eq(c.border, '0', 'border'); eq(c['box-shadow'], 'none', 'box-shadow'); eq(c.padding, '0', 'padding');
    ok(!/>付款方式</.test(appJs), 'app.js 裡還有「付款方式」標題');
});
t('第一行（LINE Pay）上面沒有多出來的分隔線，第二行（銀行）有', () => {
    const card = methods(), r1 = E.addChild(card, { classes: ['pay-method-row'] }), r2 = E.addChild(card, { classes: ['pay-method-row'] });
    eq(E.computed(r1)['border-top'], '0', '第一行'); ok(/1px solid/.test(E.computed(r2)['border-top']), '第二行：' + E.computed(r2)['border-top']);
});
t('「複製帳號」按鈕是白色：白底、細邊框、深色字', () => {
    const row = E.addChild(methods(), { classes: ['pay-method-row'] }), bank = E.addChild(row, { classes: ['pay-bank'] }), acct = E.addChild(bank, { classes: ['pay-bank-account'] });
    const b = E.computed(E.addChild(acct, { tag: 'button', classes: ['pay-copy-btn'] }));
    eq(b.background, '#fff', 'background'); eq(b.border, '1px solid #dedfd6', 'border'); eq(b.color, '#26352f', 'color');
});
t('付款方式的字體比例：項目 16px 半粗／銀行說明 13px／帳號 17px 半粗', () => {
    const row = E.addChild(methods(), { classes: ['pay-method-row'] }), bank = E.addChild(row, { classes: ['pay-bank'] });
    const g = (cls, parent = bank) => E.computed(E.addChild(parent, { classes: [cls] }));
    const num = g('pay-bank-number', E.addChild(bank, { classes: ['pay-bank-account'] }));
    eq(g('pay-method-name', row)['font-size'], '16px'); eq(g('pay-method-name', row)['font-weight'], '600');
    eq(g('pay-bank-head')['font-size'], '13px'); eq(g('pay-bank-holder')['font-size'], '13px');
    eq(num['font-size'], '17px'); eq(num['font-weight'], '600');
});
t('繳費狀態不是色塊（沒有底色）；回報按鈕滿版、50px 高', () => {
    const wrap = E.addChild(payTop(), { id: 'pay-status-banner' });
    for (const k of ['unpaid', 'paid', 'reported', 'none']) eq(E.computed(E.addChild(wrap, { classes: ['pay-banner', `pay-banner-${k}`] })).background, 'none', k);
    const btn = E.computed(E.addChild(home('pay-report-area'), { tag: 'button', classes: ['pay-report-btn'] }));
    eq(btn.width, '100%'); eq(btn['min-height'], '50px');
});
t('金額標題一行，金額與「共 N 小時」同一行（格狀排版）', () => {
    eq(E.computed(E.find((n) => n.classes.has('pay-amount-block')))['display'], 'grid');
    eq(E.computed(E.find((n) => n.classes.has('pay-amount-label')))['grid-column'], '1 / -1');
});

console.log('\n【左右切換：所有日曆長一樣】');
const arrows = [
    ['教練財務月份 ◄', (n) => n.id === 'income-month-prev'], ['教練財務月份 ►', (n) => n.id === 'income-month-next'],
    ['學習歷程年份 ◄', (n) => n.id === 'chart-year-prev'], ['學習歷程年份 ►', (n) => n.id === 'chart-year-next'],
    ['繳費月份 ◄', (n) => n.id === 'pay-month-prev'], ['繳費月份 ►', (n) => n.id === 'pay-month-next'],
    ['課程日曆 ◄', (n) => (n.attrs.onclick || '').includes('changeStudentMonth(-1)')], ['課程日曆 ►', (n) => (n.attrs.onclick || '').includes('changeStudentMonth(1)')],
    ['教練週切換 ◄', (n) => (n.attrs.onclick || '').includes('changeWeek(-1)')], ['教練週切換 ►', (n) => (n.attrs.onclick || '').includes('changeWeek(1)')]
];
for (const [name, pred] of arrows) t(`${name}：透明底、沒有邊框、沒有圓角（手機與電腦）`, () => {
    const el = E.find(pred); ok(el, '找不到按鈕');
    for (const vp of [M, D]) { const c = E.computed(el, vp); eq(c.background, 'transparent', `background @${vp.w}`); eq(c.border, '0', `border @${vp.w}`); eq(c['border-radius'], '0', `radius @${vp.w}`); }
});
t('四個月份／年份標籤的字體一樣（17px、半粗、深色）', () => {
    const ids = ['pay-month-label', 'chart-year-label', 'income-month-label', 'student-month-label'];
    const base = E.computed(E.byId(ids[0]));
    for (const id of ids) for (const p of ['font-size', 'font-weight', 'color']) eq(E.computed(E.byId(id))[p], base[p], `${id} 的 ${p}`);
    eq(base['font-size'], '17px');
});

function ok(c, msg) { if (!c) throw new Error(msg || '條件不成立'); }
console.log(`\n結果：${pass} 項通過、${fail} 項失敗`);
process.exit(fail ? 1 : 0);
