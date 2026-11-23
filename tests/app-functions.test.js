'use strict';
// 執行方式：node tests/app-functions.test.js （不需要安裝套件、不會連線）
// 做法：把 app.js、cal-gemini.js 裡真正的函式原文取出來，配上假的 Firestore 資料庫執行，
//       所以測的就是網站實際使用的程式碼；函式改名或被刪掉時，這裡會直接報「找不到函式」。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const calSrc = fs.readFileSync(path.join(root, 'cal-gemini.js'), 'utf8');

// 取出以 marker 開頭的函式（含結尾的大括號）
function extract(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error(`找不到函式：${marker}`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1) + ';';
}

function makeEnv({ courses = [], students = {}, studentsLoaded = false } = {}) {
    const store = new Map();
    const k = (c, id) => `${c}/${id}`;
    const el = {};
    const logs = [];
    const sandbox = {
        db: {}, window: { courses }, currentUser: { role: 'coach' },
        coachStudentsSnap: students, coachStudentsLoaded: studentsLoaded,
        console: { log() {}, warn() {}, error: (...a) => logs.push(a.join(' ')) },
        document: { getElementById: (id) => (el[id] = el[id] || { innerText: '', disabled: false }) },
        collection: (_d, col) => ({ col }),
        doc: (_d, col, id) => ({ col, id }),
        getDoc: async (r) => { const v = store.get(k(r.col, r.id)); return { exists: () => v !== undefined, data: () => (v ? { ...v } : undefined) }; },
        setDoc: async (r, data, opts) => { const key = k(r.col, r.id); store.set(key, opts && opts.merge ? { ...(store.get(key) || {}), ...data } : { ...data }); },
        getDocs: async (c) => {
            const docs = [...store.entries()].filter(([key]) => key.startsWith(c.col + '/')).map(([key, v]) => ({ id: key.slice(c.col.length + 1), data: () => ({ ...v }) }));
            return { docs, size: docs.length, forEach: (cb) => docs.forEach(cb) };
        }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(extract(calSrc, 'function baseStudentName(name)') + '\nwindow.baseStudentName = baseStudentName;', ctx);
    return {
        ctx, store, el, logs,
        load: (marker) => vm.runInContext(extract(appSrc, marker), ctx),
        put: (col, id, data) => store.set(k(col, id), data),
        get: (col, id) => store.get(k(col, id)),
        ids: (col) => [...store.keys()].filter((x) => x.startsWith(col + '/')).map((x) => x.slice(col.length + 1)).sort()
    };
}

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ✅ ' + name); };
const eq = (a, b, msg) => require('assert').deepStrictEqual(a, b, msg);

(async () => {
    console.log('\n【排課：自動建立「基本名字」那一筆學生資料】');
    await t('排「Nancy(團體)」→ 同時有 Nancy(團體)（記學費）與 Nancy（設 Email 用）', async () => {
        const e = makeEnv(); e.load('window.uploadEvent = async');
        await e.ctx.window.uploadEvent({ id: 1, name: 'Nancy(團體)', type: 'work', price: '600', date: '2026-11-28' });
        eq(e.ids('students'), ['Nancy', 'Nancy(團體)']);
        eq(e.get('students', 'Nancy(團體)'), { defaultPrice: 600, isStudent: true });
        eq(e.get('students', 'Nancy'), { isStudent: true });
        eq(e.get('events', '1').studentBase, 'Nancy');
    });
    await t('基本名字那筆已經設好 Email → 不會被洗掉', async () => {
        const e = makeEnv(); e.load('window.uploadEvent = async');
        e.put('students', 'Marvin', { email: 'm@x.com', isStudent: true });
        await e.ctx.window.uploadEvent({ id: 2, name: 'Marvin(個別)', type: 'work', price: 900, date: '2026-11-28' });
        eq(e.get('students', 'Marvin'), { email: 'm@x.com', isStudent: true });
        eq(e.get('students', 'Marvin(個別)').defaultPrice, 900);
    });
    await t('名字沒有括號 → 不會多建資料', async () => {
        const e = makeEnv(); e.load('window.uploadEvent = async');
        await e.ctx.window.uploadEvent({ id: 3, name: '陳明達', type: 'work', price: 700, date: '2026-11-28' });
        eq(e.ids('students'), ['陳明達']);
    });
    await t('不是教球的行程（上課、其他）→ 不建立任何學生資料，課程照常儲存', async () => {
        const e = makeEnv(); e.load('window.uploadEvent = async');
        await e.ctx.window.uploadEvent({ id: 4, name: '台大課(上課)', type: 'school', price: 0, date: '2026-11-28' });
        eq(e.ids('students'), []); eq(e.ids('events'), ['4']);
    });
    await t('中文全形括號「Angie（個別）」也一樣', async () => {
        const e = makeEnv(); e.load('window.uploadEvent = async');
        await e.ctx.window.uploadEvent({ id: 5, name: 'Angie（個別）', type: 'work', price: 800, date: '2026-11-28' });
        eq(e.ids('students'), ['Angie', 'Angie（個別）']);
    });

    console.log('\n【補齊既有資料：補上缺少的基本名字】');
    const seed = (e) => {
        e.put('students', 'Nancy(團體)', { isStudent: true, defaultPrice: 600 });
        e.put('students', '陳明達', { isStudent: true });
        e.put('students', 'Marvin', { email: 'm@x.com', isStudent: true });
        e.put('students', 'Marvin(個別)', { isStudent: true, defaultPrice: 900 });
        e.put('events', 'e1', { name: 'Nancy(團體)', type: 'work' });
        e.put('events', 'e2', { name: '陳明達', type: 'work', studentBase: '陳明達' });
        e.put('events', 'e3', { name: 'Angie(個別)', type: 'work' });
        e.put('events', 'e4', { name: 'Marvin(個別)', type: 'work', studentBase: 'Marvin' });
        e.put('events', 'e5', { name: 'X(課)', type: 'school' });
    };
    await t('只有 Nancy(團體)、或只有課程沒有學生資料的 Angie → 補上 Nancy 與 Angie；Marvin 的 Email 不動', async () => {
        const e = makeEnv(); seed(e);
        e.load('function updateMaintenanceHint()'); e.load('function countMissingBaseStudents()'); e.load('window.backfillStudentBase = async');
        await e.ctx.window.backfillStudentBase();
        eq(e.ids('students'), ['Angie', 'Marvin', 'Marvin(個別)', 'Nancy', 'Nancy(團體)', '陳明達']);
        eq(e.get('students', 'Marvin').email, 'm@x.com');
        eq(e.get('students', 'Nancy'), { isStudent: true });
        eq(e.get('events', 'e1').studentBase, 'Nancy');
        eq(e.get('events', 'e3').studentBase, 'Angie');
        eq(e.logs, []);
    });
    await t('不是教球的行程不會建立學生（沒有「X」）；回報訊息寫出補了幾個', async () => {
        const e = makeEnv(); seed(e);
        e.load('function updateMaintenanceHint()'); e.load('function countMissingBaseStudents()'); e.load('window.backfillStudentBase = async');
        await e.ctx.window.backfillStudentBase();
        eq(e.ids('students').includes('X'), false);
        eq(e.el['maintenance-result'].innerText.includes('補上缺少的基本名字 2 個'), true, e.el['maintenance-result'].innerText);
    });
    await t('重複按沒有影響：第二次補 0 個、資料不變', async () => {
        const e = makeEnv(); seed(e);
        e.load('function updateMaintenanceHint()'); e.load('function countMissingBaseStudents()'); e.load('window.backfillStudentBase = async');
        await e.ctx.window.backfillStudentBase(); const after1 = e.ids('students');
        await e.ctx.window.backfillStudentBase();
        eq(e.ids('students'), after1);
        eq(e.el['maintenance-result'].innerText.includes('補上缺少的基本名字 0 個'), true);
    });

    console.log('\n【總覽的提示文字】');
    const hint = (o) => { const e = makeEnv(o); e.load('function updateMaintenanceHint()'); e.load('function countMissingBaseStudents()'); e.ctx.updateMaintenanceHint(); return e.el['maintenance-hint'].innerText; };
    await t('學生資料還沒讀回來時，不會誤報「缺少基本名字」', async () => {
        eq(hint({ studentsLoaded: false, courses: [{ name: 'Nancy(團體)', type: 'work', studentBase: 'Nancy' }] }).includes('缺少'), false);
    });
    await t('有課但沒有基本名字 → 提示人數；補好後恢復「都已補齊」', async () => {
        const courses = [{ name: 'Nancy(團體)', type: 'work', studentBase: 'Nancy' }];
        eq(hint({ studentsLoaded: true, students: { 'Nancy(團體)': {} }, courses }).includes('1 位學生缺少「基本名字」'), true);
        eq(hint({ studentsLoaded: true, students: { 'Nancy(團體)': {}, Nancy: {} }, courses }).includes('都已補齊'), true);
    });
    await t('課程缺 studentBase 的提示照舊', async () => {
        eq(hint({ studentsLoaded: true, students: { Nancy: {} }, courses: [{ name: 'Nancy(團體)', type: 'work' }] }).includes('1 筆課程需要補齊'), true);
    });

    console.log('\n【學生資訊：會不會收到提醒的標示】');
    const e0 = makeEnv(); e0.load('function describeStudentRow'); e0.load('function reminderStatusText');
    const row = (n, d, a) => e0.ctx.describeStudentRow(n, d, a);
    await t('已綁定＋已核准 → 「✅ 已核准 · 🔔 會收到提醒」', async () => {
        const r = row('Marvin', { email: 'm@x.com', defaultPrice: 900 }, true);
        eq(r.text, 'm@x.com · 預設學費 $900 · ✅ 已核准 · 🔔 會收到提醒'); eq([r.unbound, r.pending], [false, false]);
    });
    await t('已綁定、待核准 → 收不到提醒，橘色（pending）', async () => {
        const r = row('小華', { email: 'h@x.com' }, false);
        eq(r.text, 'h@x.com · 預設學費 — · ⏳ 待核准 · 🔕 收不到提醒'); eq([r.unbound, r.pending], [false, true]);
    });
    await t('沒有 Email → 收不到提醒，橘色（unbound）', async () => {
        const r = row('陳明達', { isStudent: true, defaultPrice: 700 }, false);
        eq(r.text, '尚未綁定帳號 · 預設學費 $700 · 🔕 收不到提醒'); eq([r.unbound, r.pending], [true, false]);
    });
    await t('Nancy(團體) 這類子項目：說明以 Nancy 為準，不再顯示橘色的「尚未綁定帳號」', async () => {
        const r = row('Nancy(團體)', { isStudent: true, defaultPrice: 600 }, false);
        eq(r.text, '預設學費 $600 · 帳號與提醒以「Nancy」為準'); eq([r.unbound, r.pending], [false, false]);
    });
    await t('個人頁「上課提醒」那一行的四種情況', async () => {
        const f = (n, m, a) => JSON.parse(JSON.stringify(e0.ctx.reminderStatusText(n, m, a)));   // 轉成一般物件再比對
        eq(f('Marvin', 'm@x.com', true), { text: '🔔 會收到（上課前一天 21:00 寄到 m@x.com）', off: false });
        eq(f('Marvin', 'm@x.com', false), { text: '🔕 收不到（尚未核准）', off: true });
        eq(f('Marvin', '', false), { text: '🔕 收不到（還沒綁定 Email）', off: true });
        eq(f('Nancy(團體)', '', false), { text: '以「Nancy」為準', off: false });
    });

    console.log(`\n結果：${pass} 項通過、0 項失敗`);
})().catch((err) => { console.error('\n❌ 測試失敗：', err.message); process.exit(1); });
