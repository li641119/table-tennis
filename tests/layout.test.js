'use strict';
// 執行方式：node tests/layout.test.js
// 這是「樣式規則」的檢查：確認網頁、樣式、程式裡寫的內容符合設計。
// 「元素最後實際套用到什麼樣子」（含權重、繼承、手機／電腦）由 tests/effective-style.test.js 負責。
// 它不會真的把畫面畫出來，所以字距、實際高度要在手機上看；這裡負責防止規則被改壞或前後矛盾。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), css = read('cal-gemini.css'), cal = read('cal-gemini.js'), app = read('app.js');
const nc = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 把樣式拆成「選擇器 → 內容」（@media 裡面的規則也會被展開），同一個選擇器後面出現的寫法會蓋掉前面的
const rules = [...nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')), body: m[2] }));
const decl = (sel, prop) => {
    let v = '';
    for (const r of rules) if (r.sels.includes(sel)) { const m = r.body.match(new RegExp('(?:^|[;\\s])' + prop + ':\\s*([^;]+)')); if (m) v = m[1].trim(); }
    return v;
};
// 只看「基本規則」（檔案裡第一次出現的寫法）；特別矮的手機另有縮小版，不算在內
const declBase = (sel, prop) => { const r = rules.find((x) => x.sels.includes(sel) && new RegExp('(?:^|[;\\s])' + prop + ':').test(x.body)); const m = r && r.body.match(new RegExp('(?:^|[;\\s])' + prop + ':\\s*([^;]+)')); return m ? m[1].trim() : ''; };
const has = (sel) => rules.some((r) => r.sels.includes(sel));

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✅ ' + name); };
const eq = (a, b, msg) => require('assert').strictEqual(a, b, msg);
const ok = (c, msg) => require('assert').ok(c, msg);

console.log('\n【左右切換：所有日曆長一樣，沒有框框】');
t('網頁裡不再有 ◀ ▶ ⬅️ ➡️（iPhone 會把它們變成有方框的圖示），改用 ◄ ►', () => {
    eq(['◀', '▶', '⬅', '➡'].reduce((n, x) => n + html.split(x).length - 1, 0), 0);
    eq((html.match(/class="nav-arrow"/g) || []).length, 10);
});
t('五處切換（教練週、財務月、課程日曆、學習歷程年、繳費月）各有 ◄ 與 ►', () => {
    for (const fn of ['changeWeek', 'changeIncomeMonth', 'changeStudentMonth', 'changeChartYear', 'changePayMonth']) {
        ok(new RegExp(`${fn}\\(-1\\)[^>]*>◄<`).test(html), `${fn} 缺少 ◄`);
        ok(new RegExp(`${fn}\\(1\\)[^>]*>►<`).test(html), `${fn} 缺少 ►`);
    }
});
t('箭頭按鈕：透明底、沒有邊框、沒有陰影、沒有圓角方塊', () => {
    const s = '.nav-switcher .nav-arrow';
    eq(decl(s, 'background'), 'transparent'); eq(decl(s, 'border'), '0'); eq(decl(s, 'box-shadow'), 'none'); eq(decl(s, 'border-radius'), '0');
    eq(decl(s, 'min-width'), '44px'); eq(decl(s, 'min-height'), '44px');
});
t('教練的浮動週切換：箭頭與「本週」各自沒有框', () => {
    for (const s of ['.floating-controls .nav-arrow', '.floating-controls .today-btn']) { eq(decl(s, 'background'), 'transparent', s); eq(decl(s, 'border'), '0', s); eq(decl(s, 'box-shadow'), 'none', s); }
});
t('舊的各自為政的切換樣式都已移除（不會跟統一樣式打架）', () => {
    for (const s of ['.month-calendar-header button', '.year-switcher button', '.pay-month-switcher button', '.income-month-switcher button', '#chart-year-label', '#income-month-label', '#pay-month-label'])
        ok(!has(s), `還有舊規則：${s}`);
});
t('月份標籤統一成「2026年 11月」，年份是「2026年」', () => {
    ok(cal.includes('`${year}年 ${month + 1}月`') && cal.includes('`${chartYear}年`') && app.includes('`${payYear}年 ${payMonthIdx + 1}月`'));
    ok(!/\$\{(year|payYear)\} 年 \$\{/.test(cal + app), '還有「2026 年 11 月」這種帶空格的寫法');
});

console.log('\n【首頁字體】');
t('問候（Welcome back! 與姓名）還原成特別的字體：Playfair Display 斜體＋Noto Serif TC', () => {
    ok(html.includes('Playfair+Display') && html.includes('Noto+Serif+TC'));
    const g = '#student-view #panel-student-home .panel-subtitle', n = '#student-view #panel-student-home #student-name-display';
    eq(decl(g, 'font-family'), 'var(--student-greeting-latin)'); eq(decl(g, 'font-style'), 'italic');
    eq(decl(n, 'font-family'), 'var(--student-greeting-font)');
    ok(/Playfair Display/.test(decl('#student-view', '--student-greeting-latin')) && /Noto Serif TC/.test(decl('#student-view', '--student-greeting-font')));
});
t('其他文字（統計數字等）仍然是跟其他分頁一樣的黑體，不會變成襯線', () => {
    eq(decl('#student-view #panel-student-home .student-stat-card .stat-value', 'font-family'), 'var(--student-display-font)');
    ok(/JhengHei/.test(decl('#student-view', '--student-display-font')));
});
t('「下週可預約時段」的字體跟「下次上課」一模一樣（大小、粗細、行高、顏色、字型）', () => {
    const nx = '#student-view #panel-student-home #student-next-class', ch = '#student-view #panel-student-home #student-slots-content .slot-chip';
    for (const p of ['font-size', 'font-weight', 'line-height', 'color']) eq(decl(ch, p), decl(nx, p), p);
    eq(decl(nx, 'font-size'), '18px'); eq(decl(ch, 'font-family'), 'inherit');
});

console.log('\n【繳費頁：簡潔、框框少】');
const P = '#student-view #panel-student-pay';
t('「付款方式」沒有白色框：透明底、沒有邊框、沒有陰影、沒有內距', () => {
    const s = `${P} #pay-method-area .pay-card`;
    eq(decl(s, 'background'), 'transparent'); eq(decl(s, 'border'), '0'); eq(decl(s, 'box-shadow'), 'none'); eq(decl(s, 'padding'), '0');
});
t('上方「應繳金額」是白色卡片（跟學習歷程卡片同樣的白底、細邊框、圓角）；LINE Pay 與銀行區塊沒有框，只有細線', () => {
    const top = `${P} .panel-inner > .pay-card`, chart = '.progress-chart-card';
    eq(decl(top, 'background'), '#fff');
    for (const prop of ['background', 'border', 'border-radius']) eq(decl(top, prop), decl(chart, prop), `和學習歷程卡片的 ${prop} 不一樣`);
    for (const sel of [`${P} #pay-method-area .pay-card`, `${P} #pay-method-area .pay-bank`, `${P} #pay-method-area .pay-method-row`]) ok(/^(transparent)?$/.test(decl(sel, 'background')), sel + ' 不該有底色');
    ok(/1px solid/.test(decl(`${P} #pay-method-area .pay-method-row`, 'border-top')));
    // 付款方式區塊裡，只有「複製帳號」按鈕可以是白底
    const whites = rules.filter((r) => r.sels.some((x) => x.includes('#pay-method-area')) && /background:\s*#fff\b/.test(r.body)).map((r) => r.sels.join());
    eq(whites.length, 1); ok(whites[0].includes('.pay-copy-btn'), whites[0]);
});
t('繳費狀態不再是色塊：改成小圓點加文字', () => {
    for (const v of ['', '-unpaid', '-reported', '-paid', '-none']) eq(decl(`${P} .pay-banner${v}`, 'background'), 'none', v);
    ok(has(`${P} .pay-banner::before`) && decl(`${P} .pay-banner::before`, 'border-radius') === '50%');
});
t('「應繳金額」標題一行；金額與「共 N 小時」在同一行（網頁裡的順序＋格狀排版）', () => {
    const blk = (html.match(/<div class="pay-amount-block">([\s\S]*?)<\/div>/) || [])[1] || '';
    ok(/pay-amount-label[\s\S]*pay-amount"[\s\S]*pay-hours/.test(blk));
    eq(decl(`${P} .pay-amount-block`, 'display'), 'grid'); eq(decl(`${P} .pay-amount-label`, 'grid-column'), '1 / -1');
    ok(/auto$/.test(decl(`${P} .pay-amount-block`, 'grid-template-columns')), '金額在左、時數在右');
});
t('金額與明細不擠在一起：金額字級加大、明細每行獨立、行高寬鬆', () => {
    const first = rules.find((r) => r.sels.includes(`${P} .pay-amount`)).body.match(/font-size:\s*([^;]+)/)[1];   // 一般情況的基本規則（特別矮的手機另有縮小版）
    ok(/clamp\(32px, 10vw, 40px\)/.test(first), first);
    eq(decl(`${P} .pay-breakdown-line`, 'display'), 'block'); eq(decl(`${P} .pay-breakdown`, 'line-height'), '1.8');
});
t('銀行區塊：第一行「銀行（代碼）　戶名」、第二行「帳號　複製」', () => {
    ok(/"head holder" "acct acct"/.test(decl(`${P} #pay-method-area .pay-bank`, 'grid-template-areas')));
});
t('「複製帳號」按鈕是白色（白底、細邊框、深色字），不是淡綠色', () => {
    const c = `${P} #pay-method-area .pay-copy-btn`;
    eq(decl(c, 'background'), '#fff'); ok(/1px solid/.test(decl(c, 'border'))); eq(decl(c, 'color'), 'var(--student-ink)');
});
t('回報按鈕在上方卡片裡，滿版、深色、夠高', () => {
    const iR = html.indexOf('id="pay-report-area"'), iM = html.indexOf('id="pay-method-area"'), iB = html.indexOf('id="pay-breakdown"');
    ok(iB > 0 && iB < iR && iR < iM);
    eq(declBase(`${P} .pay-report-btn`, 'width'), '100%'); eq(declBase(`${P} .pay-report-btn`, 'min-height'), '50px');
});

console.log('\n【註冊頁】');
t('姓名欄位的說明是「請使用本名」', () => {
    ok(/<input[^>]*id="register-name"[^>]*placeholder="請使用本名"/.test(html));
});
t('註冊成功的提示說明「還要等教練核准、不需要重新註冊」', () => {
    const m = app.match(/alert\("✅ 註冊成功[^;]*;/);
    ok(m, '找不到註冊成功的提示');
    ok(m[0].includes('等待教練核准') && m[0].includes('不需要重新註冊') && m[0].includes('課表就會自動出現'), m[0]);
});

console.log('\n【整體】');
t('樣式檔大括號成對', () => eq((nc.match(/\{/g) || []).length, (nc.match(/\}/g) || []).length));
t('網頁引用的版本號是最新的（不然使用者會繼續看到舊畫面）', () => {
    const { computeVersion, FILES } = require('../scripts/bump-version.js');
    const v = computeVersion();
    for (const f of FILES) ok(html.includes(`${f}?v=${v}"`), `${f} 的版本號不是最新的，請執行：node scripts/bump-version.js`);
});

console.log(`\n結果：${pass} 項通過、0 項失敗`);
