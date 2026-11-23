'use strict';
/**
 * 迷你「樣式引擎」：給一個元素（連同它的祖先），算出瀏覽器「最後」會套用哪條規則。
 *
 * 為什麼要有：只檢查「規則寫了什麼」，會漏掉兩種常見的狀況——
 *   1. 規則根本沒套到這個元素（例如 class 選錯、元素其實沒有那個 class）
 *   2. 規則被權重更高的舊規則（ID、:has()、!important）蓋掉
 * 這裡會計算：選擇器是否符合（含祖先、>、:first-child、:not()、:has() 等）、權重、!important、
 * 出現順序、繼承（字體、顏色、對齊…）、CSS 變數 var()、手機或電腦的畫面寬度（@media）。
 *
 * 限制（它不是瀏覽器）：不會排版，所以算不出實際高度；:hover 等狀態不處理；+ ~ 選擇器不處理。
 */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing',
    'text-align', 'white-space', 'visibility', 'cursor', 'word-break', 'overflow-wrap', 'font-variant-numeric']);
const UA_DISPLAY = { html: 'block', body: 'block', div: 'block', p: 'block', h1: 'block', h2: 'block', h3: 'block', section: 'block',
    span: 'inline', a: 'inline', b: 'inline', strong: 'inline', small: 'inline', label: 'inline', svg: 'inline',
    button: 'inline-block', input: 'inline-block', select: 'inline-block', textarea: 'inline-block' };

// ───────── 小工具：在最外層（括號外）切開字串 ─────────
function splitTop(s, sep) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
}

// ───────── 解析 CSS ─────────
function parseMedia(head) {
    const m = { minW: 0, maxW: Infinity, minH: 0, maxH: Infinity, ok: true };
    for (const part of head.replace(/^@media\s*/, '').split(/\s+and\s+/)) {
        const mm = part.trim().match(/^\((min|max)-(width|height):\s*(\d+(?:\.\d+)?)px\)$/);
        if (!mm) { m.ok = false; continue; }
        const v = Number(mm[3]);
        if (mm[1] === 'min') { if (mm[2] === 'width') m.minW = Math.max(m.minW, v); else m.minH = Math.max(m.minH, v); }
        else if (mm[2] === 'width') m.maxW = Math.min(m.maxW, v); else m.maxH = Math.min(m.maxH, v);
    }
    return m;
}
const mergeMedia = (a, b) => (!a ? b : { minW: Math.max(a.minW, b.minW), maxW: Math.min(a.maxW, b.maxW), minH: Math.max(a.minH, b.minH), maxH: Math.min(a.maxH, b.maxH), ok: a.ok && b.ok });
const mediaMatches = (m, vp) => !m || (m.ok && vp.w >= m.minW && vp.w <= m.maxW && vp.h >= m.minH && vp.h <= m.maxH);

function expand(prop, value) {
    if (prop === 'margin' || prop === 'padding') {   // 1～4 個值的縮寫，展開成四個方向，才能跟 margin-top 之類的寫法比出先後
        const v = splitTop(value, ' ').map((x) => x.trim()).filter(Boolean);
        const top = v[0], right = v[1] ?? v[0], bottom = v[2] ?? v[0], left = v[3] ?? right;
        return [[prop, value], [`${prop}-top`, top], [`${prop}-right`, right], [`${prop}-bottom`, bottom], [`${prop}-left`, left]];
    }
    if (prop === 'font' && value === 'inherit') return ['font-size', 'font-weight', 'font-style', 'line-height', 'font-family'].map((p) => [p, 'inherit']);
    return [[prop, value]];
}

function parseDecls(body) {
    const d = {};
    for (const part of splitTop(body, ';')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const prop = part.slice(0, i).trim().toLowerCase();
        let value = part.slice(i + 1).trim();
        if (!prop || !value) continue;
        const important = /!important\s*$/i.test(value);
        value = value.replace(/\s*!important\s*$/i, '').trim();
        for (const [p, v] of expand(prop, value)) d[p] = { value: v, important };
    }
    return d;
}

function parseCompound(c) {
    const out = { tag: null, id: null, classes: [], attrs: [], pseudos: [], pseudoEl: false };
    let i = 0;
    const m0 = c.match(/^(\*|[a-zA-Z][\w-]*)/);
    if (m0) { out.tag = m0[1] === '*' ? null : m0[1].toLowerCase(); i = m0[0].length; }
    while (i < c.length) {
        const ch = c[i];
        if (ch === '#') { const m = c.slice(i).match(/^#([\w-]+)/); out.id = m[1]; i += m[0].length; }
        else if (ch === '.') { const m = c.slice(i).match(/^\.([\w-]+)/); out.classes.push(m[1]); i += m[0].length; }
        else if (ch === '[') { const end = c.indexOf(']', i); out.attrs.push(c.slice(i + 1, end)); i = end + 1; }
        else if (ch === ':' && c[i + 1] === ':') { out.pseudoEl = true; i += c.slice(i).match(/^::[\w-]+/)[0].length; }
        else if (ch === ':') {
            const m = c.slice(i).match(/^:([\w-]+)/); i += m[0].length;
            let arg = null;
            if (c[i] === '(') { let depth = 0, j = i; for (; j < c.length; j++) { if (c[j] === '(') depth++; else if (c[j] === ')' && --depth === 0) break; } arg = c.slice(i + 1, j); i = j + 1; }
            out.pseudos.push({ name: m[1], arg });
        } else i++;
    }
    return out;
}

function parseSelector(sel) {
    const steps = []; let cur = '', comb = ' ', depth = 0;
    const flush = () => { if (cur) { steps.push({ comb, c: parseCompound(cur) }); cur = ''; comb = ' '; } };
    for (const ch of sel) {
        if (ch === '(' || ch === '[') depth++;
        if (ch === ')' || ch === ']') depth--;
        if (depth === 0 && /\s/.test(ch)) { flush(); continue; }
        if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) { flush(); comb = ch; continue; }
        cur += ch;
    }
    flush();
    return steps;
}

function specificity(steps) {
    let a = 0, b = 0, c = 0;
    const add = (comp) => {
        if (comp.id) a++;
        b += comp.classes.length + comp.attrs.length;
        if (comp.tag) c++;
        for (const p of comp.pseudos) {
            if (p.name === 'not' && p.arg) add(parseCompound(p.arg.trim()));
            else if (p.name === 'has') { /* 看括號裡面的 */ const inner = parseSelector(p.arg.replace(/^\s*>\s*/, '')); inner.forEach((s) => add(s.c)); }
            else b++;
        }
    };
    steps.forEach((s) => add(s.c));
    return a * 10000 + b * 100 + c;
}

function parseCss(text) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = []; let order = 0;
    (function walk(src, media) {
        let i = 0;
        while (i < src.length) {
            const open = src.indexOf('{', i);
            if (open < 0) break;
            const head = src.slice(i, open).trim();
            let depth = 1, j = open + 1;
            while (j < src.length && depth) { const ch = src[j++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
            const body = src.slice(open + 1, j - 1);
            if (/^@media/.test(head)) walk(body, mergeMedia(media, parseMedia(head)));
            else if (!head.startsWith('@')) {
                const decls = parseDecls(body);
                for (const sel of splitTop(head, ',')) {
                    const s = sel.trim();
                    if (!s) continue;
                    const steps = parseSelector(s);
                    rules.push({ sel: s, steps, spec: specificity(steps), decls, media, order: order++ });
                }
            }
            i = j;
        }
    })(css, null);
    return rules;
}

// ───────── 比對選擇器與元素 ─────────
function matchAttr(a, el) {
    const m = a.match(/^([\w-]+)\s*(?:(=)\s*["']?([^"']*)["']?)?$/);
    if (!m) return false;
    const v = el.attrs[m[1]];
    return m[2] ? v === m[3] : v !== undefined;
}

function matchPseudo(p, el) {
    const sibs = el.parent ? el.parent.children : [el];
    const idx = sibs.indexOf(el);
    const same = sibs.filter((s) => s.tag === el.tag);
    switch (p.name) {
        case 'root': return el.tag === 'html';
        case 'first-child': return idx === 0;
        case 'last-child': return idx === sibs.length - 1;
        case 'only-child': return sibs.length === 1;
        case 'first-of-type': return same.indexOf(el) === 0;
        case 'last-of-type': return same.indexOf(el) === same.length - 1;
        case 'nth-child': { const a = String(p.arg).trim(), n = idx + 1; return a === 'odd' ? n % 2 === 1 : a === 'even' ? n % 2 === 0 : Number(a) === n; }
        case 'not': return !matchCompound(parseCompound(p.arg.trim()), el);
        case 'has': {
            const direct = /^\s*>/.test(p.arg);
            const inner = parseCompound(p.arg.replace(/^\s*>\s*/, '').trim());
            const any = (n) => n.children.some((ch) => matchCompound(inner, ch) || (!direct && any(ch)));
            return any(el);
        }
        default: return false;   // :hover :active :disabled :empty 等狀態：視為沒套到
    }
}

function matchCompound(c, el) {
    if (c.pseudoEl) return false;
    if (c.tag && el.tag !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    for (const k of c.classes) if (!el.classes.has(k)) return false;
    for (const a of c.attrs) if (!matchAttr(a, el)) return false;
    for (const p of c.pseudos) if (!matchPseudo(p, el)) return false;
    return true;
}

function matchSteps(steps, idx, el) {
    const step = steps[idx];
    if (!matchCompound(step.c, el)) return false;
    if (idx === 0) return true;
    if (step.comb === '>') return !!el.parent && matchSteps(steps, idx - 1, el.parent);
    if (step.comb === ' ') { for (let p = el.parent; p; p = p.parent) if (matchSteps(steps, idx - 1, p)) return true; return false; }
    return false;   // + ~ 不處理
}

// ───────── 層疊與繼承 ─────────
function declared(el, rules, vp) {
    const entries = [];
    for (const r of rules) {
        if (!mediaMatches(r.media, vp) || !matchSteps(r.steps, r.steps.length - 1, el)) continue;
        for (const [p, d] of Object.entries(r.decls)) entries.push({ p, value: d.value, imp: d.important, spec: r.spec, order: r.order, by: r.sel });
    }
    entries.sort((a, b) => (a.imp - b.imp) || (a.spec - b.spec) || (a.order - b.order));   // !important > 權重 > 出現順序
    const out = {};
    for (const e of entries) out[e.p] = e;   // 排在後面的蓋掉前面的，最後留下的就是贏家
    return out;
}

function resolveVars(v, customs, depth = 0) {
    if (depth > 8) return v;
    return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name, fb) => {
        if (customs[name] !== undefined) return resolveVars(customs[name], customs, depth + 1);
        return fb !== undefined ? resolveVars(fb.trim(), customs, depth + 1) : m;
    });
}

function computed(el, rules, vp) {
    const chain = [];
    for (let n = el; n; n = n.parent) chain.unshift(n);
    let prev = { customs: {}, props: {} };
    for (const node of chain) {
        const decl = declared(node, rules, vp);
        const customs = { ...prev.customs };
        for (const [p, e] of Object.entries(decl)) if (p.startsWith('--')) customs[p] = e.value;
        const props = {};
        for (const k of Object.keys(prev.props)) if (INHERITED.has(k)) props[k] = prev.props[k];
        for (const [p, e] of Object.entries(decl)) {
            if (p.startsWith('--')) continue;
            if (e.value === 'inherit') { if (prev.props[p]) props[p] = prev.props[p]; else delete props[p]; continue; }
            props[p] = { v: resolveVars(e.value, customs).replace(/\s+/g, ' ').trim(), by: e.by };
        }
        if (!props.display && UA_DISPLAY[node.tag]) props.display = { v: UA_DISPLAY[node.tag], by: '（瀏覽器預設）' };
        prev = { customs, props };
    }
    const out = {};
    for (const [k, x] of Object.entries(prev.props)) out[k] = x.v;
    out.__by = Object.fromEntries(Object.entries(prev.props).map(([k, x]) => [k, x.by]));
    return out;
}

// ───────── 解析網頁，建立元素樹 ─────────
function parseHtml(html) {
    const mk = (tag, parent, attrs = {}) => {
        const el = { tag, id: attrs.id || null, classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), attrs, parent, children: [] };
        if (parent) parent.children.push(el);
        return el;
    };
    const root = mk('html', null);
    const body = mk('body', root);
    const stack = [body];
    const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source']);
    const start = html.search(/<body[\s>]/);
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
    re.lastIndex = start < 0 ? 0 : html.indexOf('>', start) + 1;
    let m;
    while ((m = re.exec(html))) {
        if (!m[2]) continue;
        const closing = m[1] === '/', tag = m[2].toLowerCase();
        if (closing) {
            for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
            continue;
        }
        const attrs = {};
        m[3].replace(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g, (_, k, v1, v2) => { attrs[k] = v1 ?? v2 ?? ''; return ''; });
        const el = mk(tag, stack[stack.length - 1], attrs);
        if (tag === 'script' || tag === 'style' || tag === 'template') {   // 裡面的內容不算（template 是 JS 之後才會複製的範本）
            const close = html.indexOf(`</${tag}>`, re.lastIndex);
            re.lastIndex = close < 0 ? re.lastIndex : close + tag.length + 3;
            continue;
        }
        if (!VOID.has(tag) && !m[4]) stack.push(el);
    }
    return root;
}

const byId = (root, id) => { const f = (n) => (n.id === id ? n : n.children.reduce((r, c) => r || f(c), null)); return f(root); };
const find = (root, pred) => { const f = (n) => (pred(n) ? n : n.children.reduce((r, c) => r || f(c), null)); return f(root); };
// 模擬 JavaScript 之後才會畫出來的元素（例如沒有時段時的 <p>、銀行卡片裡的按鈕）
const addChild = (parent, { tag = 'div', id = null, classes = [], attrs = {} } = {}) => {
    const el = { tag, id, classes: new Set(classes), attrs: { ...attrs }, parent, children: [] };
    parent.children.push(el);
    return el;
};

function load({ css, html }) {
    const rules = parseCss(css);
    const root = parseHtml(html);
    return { rules, root, computed: (el, vp = { w: 390, h: 844 }) => computed(el, rules, vp), byId: (id) => byId(root, id), find: (p) => find(root, p), addChild };
}

module.exports = { load, parseCss, parseHtml, computed };
