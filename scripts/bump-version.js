'use strict';
/**
 * 更新 index.html 裡樣式與程式檔的版本號（?v=...）。
 *
 * 為什麼需要：GitHub Pages 會讓瀏覽器把 cal-gemini.css、app.js、cal-gemini.js 暫存 10 分鐘。
 * 沒有版本號的話，你 push 之後，使用者（包括你自己）會繼續看到舊畫面。
 * 版本號一變，瀏覽器就會立刻抓新檔。
 *
 * 版本號是這三個檔案「內容」的雜湊值：內容沒變，版本號就不變。
 * 用法：改完樣式或程式、push 之前，執行一次  node scripts/bump-version.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const FILES = ['cal-gemini.css', 'app.js', 'cal-gemini.js'];

function computeVersion() {
    const h = crypto.createHash('sha256');
    for (const f of FILES) h.update(fs.readFileSync(path.join(root, f)));
    return h.digest('hex').slice(0, 8);
}

function apply() {
    const p = path.join(root, 'index.html');
    const version = computeVersion();
    let count = 0;
    const html = fs.readFileSync(p, 'utf8').replace(/((?:href|src)="(?:cal-gemini\.css|app\.js|cal-gemini\.js))(?:\?v=[^"]*)?"/g, (m, head) => {
        count++;
        return `${head}?v=${version}"`;
    });
    if (count !== FILES.length) throw new Error(`index.html 裡應該有 ${FILES.length} 個引用（${FILES.join('、')}），實際找到 ${count} 個`);
    fs.writeFileSync(p, html);
    return version;
}

if (require.main === module) console.log('版本號已更新：' + apply());

module.exports = { computeVersion, FILES };
