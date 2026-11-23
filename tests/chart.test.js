'use strict';
// 執行方式：node tests/chart.test.js
// 把網站裡真正的「學習歷程折線圖」畫圖函式取出來，丟進各種時數，檢查畫出來的 SVG：
// 有沒有超出畫面邊界、數字有沒有互相重疊、縱軸的數字放不放得進左邊的留白。
// 文字寬度用「字數 × 字級」估算（偏保守，字級取手機版的 13px），不是瀏覽器的實際量測。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'cal-gemini.js'), 'utf8');

function extract(marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('找不到函式：' + marker);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    return src.slice(start, i + 1);
}

// 把一份「每月時數」畫成 SVG（year、nowStr：畫哪一年、假裝今天是哪天）
function draw(monthly, { year = 2027, nowStr = '2027-12-15T12:00:00' } = {}) {
    const NOW = new Date(nowStr).getTime();
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
    const els = {};
    const ctx = vm.createContext({
        Date: FakeDate, currentUser: { role: 'student', name: '測試' }, chartYear: year,
        STUDENT_START_YEAR: 2026, STUDENT_START_MONTH_IDX: 9,
        getEarliestLessonYear: () => 2026, getMonthlyHoursForYear: () => monthly,
        document: { getElementById: (id) => (els[id] = els[id] || { innerHTML: '', innerText: '', disabled: false }) }
    });
    vm.runInContext(extract('function niceChartScale') + '\n' + extract('function renderProgressChart'), ctx);
    ctx.renderProgressChart();
    return els['progress-chart'].innerHTML;
}

// ───────── 分析 SVG ─────────
const FS = 13;   // 手機版會把圖裡的字設成 13px（比 SVG 裡寫的 12 大），用大的比較保守
const charW = (ch) => (/[0-9]/.test(ch) ? 0.56 : ch === '.' ? 0.3 : ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6) * FS;
function analyse(svg) {
    const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), W = +vb[1], H = +vb[2];
    const texts = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((m) => {
        const x = +m[1], y = +m[2], s = m[4], w = [...s].reduce((a, c) => a + charW(c), 0);
        const left = m[3] === 'end' ? x - w : m[3] === 'middle' ? x - w / 2 : x;
        return { s, x1: left, x2: left + w, y1: y - FS * 0.8, y2: y + FS * 0.2 };
    });
    // 「小時」那個標題沒有 text-anchor 屬性，另外處理
    const unit = svg.match(/<text x="(\d+)" y="(\d+)" font-size="12"[^>]*>小時<\/text>/);
    if (unit) texts.push({ s: '小時', x1: +unit[1], x2: +unit[1] + 2 * FS, y1: +unit[2] - FS * 0.8, y2: +unit[2] + FS * 0.2 });
    const circles = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map((m) => ({ cx: +m[1], cy: +m[2], r: +m[3] }));
    const problems = [];
    for (const t of texts) if (t.x1 < 0 || t.y1 < 0 || t.x2 > W || t.y2 > H) problems.push(`「${t.s}」超出畫面邊界`);
    for (const c of circles) if (c.cx - c.r < 0 || c.cy - c.r < 0 || c.cx + c.r > W || c.cy + c.r > H) problems.push('有圓點超出畫面邊界');
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5) problems.push(`「${a.s}」與「${b.s}」互相重疊`);
    }
    const ticks = [...svg.matchAll(/text-anchor="end" font-size="12" fill="#7f8c8d">(\d+)<\/text>/g)].map((m) => +m[1]).filter((v, i, a) => a.indexOf(v) === i);
    const yLabels = texts.filter((t) => ticks.includes(+t.s) && t.x2 < 40);
    return { problems, ticks, widestTick: Math.max(0, ...yLabels.map((t) => t.x2 - t.x1)), leftMost: Math.min(...yLabels.map((t) => t.x1)) };
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✅ ' + name); } catch (e) { fail++; console.log('  ❌ ' + name + '\n       ' + e.message); } };
const check = (monthly, opts) => { const r = analyse(draw(monthly, opts)); if (r.problems.length) throw new Error([...new Set(r.problems)].join('、')); return r; };
const show = (r) => `縱軸 ${r.ticks.join('、')}`;

console.log('\n【這位學生今年上超過 80 小時（整年 12 個月都有資料）】');
t('平均每月 7 小時，全年 86 小時 → 縱軸 0～10，圖正常', () => { const r = check([6, 8, 8, 10, 8, 6, 8, 10, 8, 6, 6, 2]); console.log('       ' + show(r)); });
t('上課集中在某幾個月，單月最高 40 小時（全年約 270 小時）→ 圖正常', () => { const r = check([10, 20, 40, 30, 36, 30, 10, 8, 6, 6, 6, 2]); console.log('       ' + show(r)); });
t('單月就超過 80 小時（82 小時）→ 縱軸會自動放大到 0、50、100，圖正常', () => { const r = check([10, 20, 40, 82, 60, 30, 10, 8, 6, 6, 6, 2]); console.log('       ' + show(r)); });
t('有小數（85.5、105.5 小時）→ 數字標籤不會互相擠在一起', () => { const r = check([85.5, 90.5, 105.5, 100.5, 95.5, 88.5, 85.5, 90.5, 95.5, 100.5, 105.5, 85.5]); console.log('       ' + show(r)); });
t('單月 3 位數（120 小時）→ 縱軸的「150」也放得進左邊留白', () => { const r = check([120, 20, 40, 82, 60, 30, 10, 8, 6, 6, 6, 2]); console.log('       ' + show(r) + `；最寬的縱軸數字 ${r.widestTick.toFixed(1)}，左邊留白夠用`); });

console.log('\n【現在實際的情況：2026 年只有 10～12 月有資料】');
t('三個月合計超過 80 小時（25、30、28）→ 圖正常，只畫 10、11、12 月', () => { const r = check([0, 0, 0, 0, 0, 0, 0, 0, 0, 25, 30, 28], { year: 2026, nowStr: '2026-12-15T12:00:00' }); console.log('       ' + show(r)); });

console.log('\n【找出真正會出問題的數字】');
t('每個月都一樣高、數字一樣長（最容易擠在一起）：找出最先壞掉的時數', () => {
    let firstBad = null;
    for (const v of [10, 50, 99, 100, 150, 500, 999, 1000, 5000, 10000, 99999, 100000]) {
        const r = analyse(draw(Array(12).fill(v)));
        if (r.problems.length && firstBad === null) firstBad = { v, why: [...new Set(r.problems)].slice(0, 2).join('、') };
    }
    console.log('       ' + (firstBad ? `單月 ${firstBad.v} 小時開始出問題：${firstBad.why}` : '測試範圍內都正常'));
    if (firstBad && firstBad.v < 1000) throw new Error(`單月 ${firstBad.v} 小時就出問題：${firstBad.why}`);
});

console.log(`\n結果：${pass} 項通過、${fail} 項失敗`);
process.exit(fail ? 1 : 0);
