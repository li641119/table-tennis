'use strict';
/**
 * 每晚寄出「隔天上課」的 Email 提醒。由 GitHub Actions 排程執行
 * （見 .github/workflows/lesson-reminder.yml）。
 *
 * 環境變數（都存在 GitHub 的 Secrets，不要寫進程式，也不要貼到聊天）：
 *   FIREBASE_SERVICE_ACCOUNT  Firebase 服務帳戶金鑰（JSON 全文，唯讀就夠）
 *   GMAIL_USER                寄件的 Gmail
 *   GMAIL_APP_PASSWORD        Gmail 的「應用程式密碼」
 * 可選：
 *   MODE         dry-run（預設，不寄給學生）｜test（全部寄給教練自己）｜send（正式寄出）
 *   TARGET_DATE  要提醒哪一天（YYYY-MM-DD）；留空＝明天（台北時間）
 *   SITE_URL     信裡的網站連結；留空會用 GITHUB_REPOSITORY 自動組出來
 *   SUMMARY_TO   摘要信寄給誰；留空＝GMAIL_USER
 *
 * 注意：GitHub 公開專案的執行紀錄是公開的，所以紀錄裡只放數量，
 *       不放學生姓名與 Email；詳細名單寄到教練自己的信箱。
 */

const TZ = 'Asia/Taipei';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 姓名括號前面的部分就是同一個學生：Marvin(個別)、Marvin（團體）都是 Marvin
// （規則與網站的 baseStudentName 相同）
function baseName(name) {
    const original = String(name ?? '').trim();
    let n = original;
    let prev;
    do {
        prev = n;
        n = n.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, '').trim();
    } while (n !== prev);
    return n || original;
}

// 台北時間的「今天」（YYYY-MM-DD）
function taipeiToday(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();   // 0＝週日
}

// 這堂課在指定日期有沒有上課（規則與網站的 courseOccursOnDate 相同）：
// 單次課看日期；每週重複的課看星期幾、請假例外、開始日與「重複到」結束日。
function occursOn(course, dateStr) {
    if (!course) return false;
    if (course.isRepeating) {
        if (!course.day) return false;
        const day = String(course.day);
        const target = day === '8' ? 0 : parseInt(day, 10) - 1;   // "2"＝週一 … "7"＝週六，"8"＝週日
        if (weekdayOf(dateStr) !== target) return false;
        if ((course.exceptions || []).map(String).includes(dateStr)) return false;
        if (course.date && dateStr < course.date) return false;
        if (course.repeatEndDate && dateStr > course.repeatEndDate) return false;
        return true;
    }
    return course.date === dateStr;
}

// 「Marvin(個別)」→「個別課」；沒有括號就回傳空字串
function lessonLabel(name) {
    const m = String(name ?? '').match(/[\(（]([^\)）]*)[\)）]\s*$/);
    const label = m ? m[1].trim() : '';
    if (!label) return '';
    return (label === '個別' || label === '團體') ? `${label}課` : label;
}

function formatDateLabel(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}（${WEEKDAYS[weekdayOf(dateStr)]}）`;
}

// 把 Email 與其他可能洩漏個資的文字遮起來（紀錄是公開的）
function scrub(text) {
    return String(text ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '***@***');
}

// 找出指定日期的教球課，並判斷每一堂該不該寄、寄給誰
function planReminders({ events, students, approved, dateStr }) {
    const lessons = (events || [])
        .filter((e) => e && e.type === 'work' && occursOn(e, dateStr))
        .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));

    const items = [];
    const skipped = [];
    for (const e of lessons) {
        const base = e.studentBase || baseName(e.name);
        const lesson = { name: e.name, base, start: e.start, end: e.end, loc: e.loc };
        const stu = students[base];
        const email = stu && stu.email ? String(stu.email).trim().toLowerCase() : '';
        if (!stu) { skipped.push({ lesson, reason: '找不到這位學生的資料' }); continue; }
        if (!email) { skipped.push({ lesson, reason: '還沒有綁定 Email' }); continue; }
        const a = approved[email];
        if (!a || a.name !== base) { skipped.push({ lesson, reason: '尚未核准' }); continue; }
        items.push({ lesson, base, email });
    }
    return { lessons, items, skipped };
}

// 一堂課一封信
function buildEmail({ base, lesson, dateStr, isTomorrow, siteUrl, testNote }) {
    const dateLabel = formatDateLabel(dateStr);
    const start = lesson.start || '—';
    const end = lesson.end || '—';
    const loc = lesson.loc || '（未填寫地點）';
    const label = lessonLabel(lesson.name);
    const dayText = isTomorrow ? `明天 ${dateLabel}` : dateLabel;

    const lines = [];
    if (testNote) lines.push(testNote, '');
    lines.push(
        `${base} 您好，`,
        '',
        `提醒您，${isTomorrow ? '明天' : dateLabel}有桌球課：`,
        '',
        `  日期　${dateLabel}`,
        `  時間　${start} – ${end}`,
        `  地點　${loc}`
    );
    if (label) lines.push(`  課別　${label}`);
    lines.push('', '如需請假或調整，請直接聯繫教練。');
    if (siteUrl) lines.push(`查看課表與繳費：${siteUrl}`);
    lines.push('', '桌球教學管理系統');

    return {
        subject: `【桌球課提醒】${dayText}${start}–${end}｜${loc}`,
        text: lines.join('\n')
    };
}

// 寄給教練自己的摘要（試跑時就是「會寄給誰」的清單）
function buildSummary({ dateStr, mode, plan, sent, failed }) {
    const dateLabel = formatDateLabel(dateStr);
    const modeText = {
        'dry-run': '試跑（沒有寄給任何學生）',
        test: '測試寄送（所有信都寄給你自己）',
        send: '正式寄出'
    }[mode];
    const desc = (lesson) => `${lesson.start || '—'}–${lesson.end || '—'} ${lesson.name}`;

    const lines = [`提醒日期：${dateLabel}`, `執行模式：${modeText}`, `當天教球課：${plan.lessons.length} 堂`, ''];
    if (mode === 'dry-run') {
        lines.push(`▍會寄出 ${plan.items.length} 封`);
        plan.items.forEach((it) => lines.push(`  ・${desc(it.lesson)} → ${it.email}`));
    } else {
        lines.push(`▍已寄出 ${sent.length} 封`);
        sent.forEach((it) => lines.push(`  ・${desc(it.lesson)} → ${it.email}`));
        if (failed.length) {
            lines.push('', `▍寄送失敗 ${failed.length} 封`);
            failed.forEach((it) => lines.push(`  ・${desc(it.lesson)} → ${it.email}（${it.error}）`));
        }
    }
    if (plan.skipped.length) {
        lines.push('', `▍沒有寄出 ${plan.skipped.length} 堂`);
        plan.skipped.forEach((s) => lines.push(`  ・${desc(s.lesson)}：${s.reason}`));
    }

    const title = mode === 'dry-run' ? '提醒試跑報告' : '提醒寄送摘要';
    const result = mode === 'dry-run'
        ? `會寄出 ${plan.items.length} 封`
        : `寄出 ${sent.length} 封${failed.length ? `、失敗 ${failed.length} 封` : ''}`;
    return {
        subject: `【${title}】${dateLabel}｜${result}、略過 ${plan.skipped.length} 堂`,
        text: lines.join('\n')
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const mode = (process.env.MODE || 'dry-run').trim();
    if (!['dry-run', 'test', 'send'].includes(mode)) throw new Error(`MODE 只能是 dry-run、test、send，收到：${mode}`);

    const missing = ['FIREBASE_SERVICE_ACCOUNT', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'].filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`缺少設定：${missing.join('、')}（請到 GitHub 的 Settings → Secrets and variables → Actions 新增）`);

    const tomorrow = addDays(taipeiToday(), 1);
    const target = (process.env.TARGET_DATE || '').trim() || tomorrow;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error(`TARGET_DATE 要寫成 YYYY-MM-DD，收到：${target}`);
    const isTomorrow = target === tomorrow;

    const [owner, repo] = String(process.env.GITHUB_REPOSITORY || '').split('/');
    const siteUrl = process.env.SITE_URL || (owner && repo ? `https://${owner.toLowerCase()}.github.io/${repo}/` : '');

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (_) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT 不是正確的 JSON（請貼上金鑰檔案的完整內容）');
    }

    const admin = require('firebase-admin');
    const nodemailer = require('nodemailer');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    const db = admin.firestore();

    const [evSnap, stSnap, apSnap] = await Promise.all([
        db.collection('events').where('type', '==', 'work').get(),
        db.collection('students').get(),
        db.collection('approvedEmails').get()
    ]);
    const events = evSnap.docs.map((d) => d.data());
    const students = {};
    stSnap.forEach((d) => { students[d.id] = d.data(); });
    const approved = {};
    apSnap.forEach((d) => { approved[d.id.toLowerCase()] = d.data(); });

    const plan = planReminders({ events, students, approved, dateStr: target });
    console.log(`提醒日期 ${target}｜模式 ${mode}｜當天教球課 ${plan.lessons.length} 堂｜可寄 ${plan.items.length} 封｜略過 ${plan.skipped.length} 堂`);
    if (plan.lessons.length === 0) {
        console.log('這天沒有教球課，不寄信。');
        return;
    }

    const gmailUser = process.env.GMAIL_USER.trim();
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') }
    });
    const from = { name: '桌球教學管理系統', address: gmailUser };
    const coach = (process.env.SUMMARY_TO || gmailUser).trim();

    const sent = [];
    const failed = [];
    if (mode !== 'dry-run') {
        for (const it of plan.items) {
            const testNote = mode === 'test' ? `（這是測試信，正式執行時會寄給：${it.email}）` : '';
            const mail = buildEmail({ base: it.base, lesson: it.lesson, dateStr: target, isTomorrow, siteUrl, testNote });
            try {
                await transporter.sendMail({
                    from,
                    to: mode === 'test' ? coach : it.email,
                    replyTo: gmailUser,
                    subject: (mode === 'test' ? '[測試] ' : '') + mail.subject,
                    text: mail.text
                });
                sent.push(it);
            } catch (err) {
                failed.push({ ...it, error: scrub(err && err.message) });
            }
            await sleep(300);
        }
    }

    const summary = buildSummary({ dateStr: target, mode, plan, sent, failed });
    await transporter.sendMail({ from, to: coach, subject: summary.subject, text: summary.text });

    console.log(`完成：寄出 ${sent.length} 封、失敗 ${failed.length} 封`);
    if (failed.length) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ 執行失敗：', scrub(err && err.message ? err.message : err));
        process.exit(1);
    });
}

module.exports = {
    baseName, taipeiToday, addDays, weekdayOf, occursOn, lessonLabel,
    formatDateLabel, scrub, planReminders, buildEmail, buildSummary
};
