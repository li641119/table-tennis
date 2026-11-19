// Firebase  全域設定
// ------------------------------------------------------------

// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { 
    getFirestore, initializeFirestore, memoryLocalCache,
    collection, query, where, getDocs, onSnapshot, setDoc, doc, deleteDoc, getDoc, 
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { 
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
    onAuthStateChanged, sendPasswordResetEmail, signOut,
    setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

// firebaseConfig
const firebaseConfig = {
  apiKey: "AIzaSyCvtWTmqmJt10icRtFRWg58SWf4JE1hXmc",
  authDomain: "calendar-2026-5ba8e.firebaseapp.com",
  projectId: "calendar-2026-5ba8e",
  storageBucket: "calendar-2026-5ba8e.firebasestorage.app",
  messagingSenderId: "357308222372",
  appId: "1:357308222372:web:153a95f8f544e6a59ecf31",
  measurementId: "G-0EP154JP2Z"
};

// db, auth
const app = initializeApp(firebaseConfig);
// 每個分頁各自獨立（記憶體快取），不跨分頁共用。
// 不要改回多分頁共用的 IndexedDB 快取：同一個瀏覽器同時登入教練與學生帳號（各開一個分頁）時，
// 兩個分頁的身分會互相干擾，教練端所有讀取都會被拒絕（permission-denied）。
const db = (() => {
    try {
        return initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch (err) {
        console.warn('Firestore 初始化設定失敗，改用預設值:', err);
        return getFirestore(app);
    }
})();
const auth = getAuth(app);

setPersistence(auth, browserSessionPersistence)
    .catch((err) => console.error("設定登入狀態保存方式失敗:", err));

let unsubscribe = null;
let suppressAuthUI = false;
const COACH_EMAIL = "li641119@gmail.com"; 

// currentUser
import { renderAll, toYMD } from './cal-gemini.js';
export let currentUser = {
    uid: null,
    email: '',
    role: 'coach', // 'coach' 或 'student'
    name: ''
};

// 使用者登入
// ------------------------------------------------------------

// 註冊
const registerForm = document.getElementById('register-form');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const typedName = document.getElementById('register-name').value.trim();
        // 學生就算打成「學生A(個別)」，也一律綁定到「學生A」
        const name = (typeof window.baseStudentName === 'function')
            ? window.baseStudentName(typedName)
            : typedName;
        const email = document.getElementById('register-email').value.trim().toLowerCase();        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;
        const errorMsg = document.getElementById('register-error');
        errorMsg.textContent = '';

        if (!name) {
            errorMsg.textContent = '請輸入姓名';
            return;
        }
        if (password.length < 6) {
            errorMsg.textContent = '密碼至少需要 6 個字元';
            return;
        }
        if (password !== confirm) {
            errorMsg.textContent = '兩次輸入的密碼不一致';
            return;
        }

        suppressAuthUI = true;
        let cred = null;

        try {
            cred = await createUserWithEmailAndPassword(auth, email, password);

            // 把這個 Email 綁到這個姓名。若這個姓名已被別的帳號綁走，Firestore 規則會拒絕（permission-denied）
            await setDoc(doc(db, "students", name), { email: email, isStudent: true }, { merge: true });
            await signOut(auth);

            registerForm.reset();
            alert("✅ 註冊成功！請使用剛剛設定的帳號密碼重新登入。");

            const loginTabBtn = document.getElementById('tab-login');
            if (loginTabBtn) loginTabBtn.click();
        } catch (error) {
            console.error("註冊失敗:", error.code || error);

            if (cred) {
                // 帳號已建好但姓名綁定失敗：把這個空帳號刪掉，學生才能用同一個 Email 重新註冊
                try { await cred.user.delete(); } catch (_) {
                    try { await signOut(auth); } catch (_2) { /* 忽略 */ }
                }
            }

            const map = {
                'auth/email-already-in-use': '這個 Email 已經被註冊過了',
                'auth/invalid-email': 'Email 格式不正確',
                'auth/weak-password': '密碼至少需要 6 個字元',
                'auth/network-request-failed': '網路連線異常，請檢查網路',
                'permission-denied': '這個姓名已經被其他帳號綁定了。請確認姓名是否正確，或聯絡教練。',
            };
            errorMsg.textContent = map[error.code] || ('註冊失敗：' + error.message);
        } finally {
            suppressAuthUI = false;
        }
    });
}

//登入
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const errorMsg = document.getElementById('login-error');
        const rememberCheckbox = document.getElementById('remember-email');
        errorMsg.textContent = '';

        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {

                if (rememberCheckbox && rememberCheckbox.checked) {
                    localStorage.setItem(REMEMBER_EMAIL_KEY, email);
                } else {
                    localStorage.removeItem(REMEMBER_EMAIL_KEY);
                }
            })
            .catch((error) => {
                console.error("登入出錯:", error.code);
                if (
                    error.code === 'auth/invalid-credential' ||
                    error.code === 'auth/wrong-password' ||
                    error.code === 'auth/user-not-found'
                ) {
                    errorMsg.textContent = "帳號或密碼錯誤";
                } else {
                    errorMsg.textContent = "登入失敗：" + error.message;
                }
            });
    });
}

//記住帳號
const REMEMBER_EMAIL_KEY = 'coach_app_remembered_email';

document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('email');
    const rememberCheckbox = document.getElementById('remember-email');
    const passwordInput = document.getElementById('password');
    const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);

    if (savedEmail && emailInput && rememberCheckbox) {
        emailInput.value = savedEmail;
        rememberCheckbox.checked = true;
        // 帳號已經帶好了，游標直接跳到密碼欄位，使用者只要打密碼
        if (passwordInput) passwordInput.focus();
    }
});

//忘記密碼
const forgotPasswordLink = document.getElementById('forgot-password-link');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const errorMsg = document.getElementById('login-error');
        const email = document.getElementById('email').value.trim();

        if (!email) {
            errorMsg.textContent = '請先在上面的電子郵件欄位輸入你的帳號信箱';
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            errorMsg.textContent = '';
            alert('📧 重設密碼信件已寄出，請至信箱收信（記得也檢查垃圾郵件匣）');
        } catch (error) {
            console.error('寄送重設密碼信失敗:', error.code);
            const map = {
                'auth/invalid-email': 'Email 格式不正確',
                'auth/user-not-found': '找不到這個 Email 對應的帳號',
                'auth/network-request-failed': '網路連線異常，請檢查網路',
            };
            errorMsg.textContent = map[error.code] || ('寄送失敗：' + error.message);
        }
    });
}

//登出
const logoutButtons = [
    document.getElementById('logout-btn'),
    document.getElementById('coach-top-logout-btn'),
    document.getElementById('coach-sidebar-logout-btn'),
    document.getElementById('student-logout-btn')
].filter(Boolean);

logoutButtons.forEach((logoutButton) => {

    logoutButton.addEventListener('click', async () => {

        const confirmed = confirm('確定要登出嗎？');
        if (!confirmed) return;

        try {
            await signOut(auth);
        } catch (err) {
            console.error("登出失敗:", err);
            alert("登出失敗，請重新整理頁面再試一次");
        }

    });

});

//onAuthStateChanged
// ------------------------------------------------------------
// 進入學生模式：用登入的 Email 找出學生姓名，並啟動課表、繳費、公告的即時監聽。
// 登入時會呼叫；學生自己重新綁定姓名之後也會再呼叫一次。
// ------------------------------------------------------------
async function enterStudentMode(user) {
    const coachView = document.getElementById('coach-view');
    const studentView = document.getElementById('student-view');
    const sidebar = document.querySelector('.sidebar');

    stopStudentData();
    stopStudentApprovalWatch();
    resetStudentView();     // 先清掉畫面，避免看到上一位使用者的資料
    let studentName = '';
    let lookupFailed = false;
    try {
        const q = query(collection(db, "students"), where("email", "==", user.email));
        const snap = await getDocs(q);
        if (!snap.empty) {
            studentName = snap.docs[0].id; // students collection 的文件 ID 就是姓名
        } else {
            console.warn("⚠️ 找不到這個 Email 對應的學生姓名。可能原因：這個帳號還沒綁定姓名，或教練刪除過這位學生的資料。");
        }
    } catch (err) {
        console.error("查詢學生姓名失敗:", err);
        lookupFailed = true;
    }

    // 查詢期間如果已經登出（或換了人），就不要再啟動任何監聽
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;

    currentUser = { uid: user.uid, email: user.email, role: 'student', name: studentName };

    if (sidebar) sidebar.style.display = 'none';
    coachView.style.display = 'none';
    coachView.classList.add('hide');
    studentView.style.display = 'block';

    const nameEl = document.getElementById('student-name-display');
    if (nameEl) nameEl.innerText = studentName || '同學';

    console.log("啟動學生模式，姓名比對用:", studentName || '(尚未找到對應姓名)');

    if (studentName) {
        // 有對應的學生資料：要等教練核准，才載入課表、繳費與收款資訊
        watchStudentApproval(user, studentName);
        return;
    }

    // 找不到學生資料：維持空狀態，並讓學生自己輸入姓名綁定
    startStudentLiveSync(studentName);
    startStudentPaymentWatchers(studentName);
    watchOverviewForStudent();

    updateOfflineBanner();
    showStudentBanner(lookupFailed
        ? '學生資料讀取失敗，請檢查網路後重新整理頁面。'
        : '找不到你的學生資料。請在下面輸入你的姓名完成綁定（要跟教練登記的一樣）。',
        lookupFailed ? 'error' : 'notfound');
    if (!lookupFailed) showStudentRebindForm();
}

// ------------------------------------------------------------
// 學生核准：學生註冊（或重新綁定姓名）之後，要等教練核准才看得到課表、繳費與收款資訊。
// 核准記錄存在 approvedEmails/{小寫 Email}，內容是 { name: 核准的姓名 }。
// 教練一核准，學生的畫面會即時切換，不用重新整理。
// ------------------------------------------------------------
let approvalUnsubStudent = null;
let studentDataRunning = false;
let studentPendingReason = null;   // null＝沒有待核准；'pending'＝等待核准；'other'＝核准的是別的姓名

function startStudentData(studentName) {
    startStudentLiveSync(studentName);
    startStudentPaymentWatchers(studentName);
    watchOverviewForStudent();
    updateOfflineBanner();
}

function stopStudentData() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    stopStudentPaymentWatchers();
    stopOverviewForStudent();
    stopStudentTimeRefresh();
}

function stopStudentApprovalWatch() {
    if (approvalUnsubStudent) { approvalUnsubStudent(); approvalUnsubStudent = null; }
    studentDataRunning = false;
}

// 還沒核准時：畫面上的欄位改成「—」，並顯示說明
function showStudentPendingState(studentName, reason) {
    studentPendingReason = reason;
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('student-total-hours', '—');
    setText('student-class-count', '—');
    setText('student-next-class', '—');
    setText('student-notice-content', '核准後顯示');
    setText('student-slots-content', '核准後顯示');
    const statusEl = document.getElementById('student-payment-status');
    if (statusEl) { statusEl.innerText = '—'; statusEl.style.color = '#90a4ae'; }
    showStudentBanner(reason === 'other'
        ? '你的帳號目前核准的是另一個姓名。請聯絡教練重新核准。'
        : `⏳ 你的帳號（${studentName}）正在等待教練核准。核准後，課程和繳費資訊會自動出現，不用重新整理。`, 'pending');
}

function watchStudentApproval(user, studentName) {
    const email = String(user.email).toLowerCase();
    approvalUnsubStudent = onSnapshot(doc(db, 'approvedEmails', email), (snap) => {
        const approved = snap.exists() && snap.data().name === studentName;
        if (approved) {
            studentPendingReason = null;
            clearStudentBanner('pending');
            if (!studentDataRunning) { studentDataRunning = true; startStudentData(studentName); }
            return;
        }
        // 還沒核准，或是被教練撤銷了
        const wasRunning = studentDataRunning;
        studentDataRunning = false;
        if (wasRunning) {
            stopStudentData();
            resetStudentView();
            const nameEl = document.getElementById('student-name-display');
            if (nameEl) nameEl.innerText = studentName;
        }
        showStudentPendingState(studentName, snap.exists() ? 'other' : 'pending');
    }, (err) => {
        console.error('讀取核准狀態失敗:', err);
        showStudentBanner('核准狀態讀取失敗，請檢查網路後重新整理頁面。', 'error');
    });
}

onAuthStateChanged(auth, async (user) => {
    if (suppressAuthUI) {
        console.log("（註冊流程進行中，暫時忽略這次 onAuthStateChanged）");
        return;
    }

    const loginContainer = document.getElementById('login-container');
    const coachView = document.getElementById('coach-view'); 
    const studentView = document.getElementById('student-view'); 
    const sidebar = document.querySelector('.sidebar');
    const logoutBtnEl = document.getElementById('logout-btn');

    if (user) {
        loginContainer.style.display = 'none';
        if (logoutBtnEl) logoutBtnEl.classList.remove('hide');

        if (user.email.toLowerCase() === COACH_EMAIL.toLowerCase()) {
            console.log("教練模式已啟動");

            currentUser = { uid: user.uid, email: user.email, role: 'coach', name: '教練' };

            coachView.classList.remove('hide');
            coachView.style.display = 'block';
            studentView.style.display = 'none';
            if (sidebar) sidebar.style.display = 'flex';

            startLiveSync();
            // 登入後主動切到「資訊總覽」，效果等同於教練自己點了一次該分頁按鈕
            const homeBtn = document.querySelector('.coach-nav-btn[data-panel="panel-overview"]');
            if (homeBtn) homeBtn.click();
            startCoachPaymentWatcher();
            startIncomeRecordsWatcher();
            startCoachApprovalWatcher();
        } else {
            await enterStudentMode(user);
            return;
        }

        // 學生端等課表資料送到後才會畫畫面，這裡不先畫，避免閃一下 0
        if (currentUser.role === 'coach') renderAll();
    } else {
        console.log("目前為登出狀態");
        loginContainer.style.display = 'flex';
        if (logoutBtnEl) logoutBtnEl.classList.add('hide');
        coachView.style.display = 'none';
        studentView.style.display = 'none';
        if (sidebar) sidebar.style.display = 'flex';

        currentUser = { uid: null, email: '', role: 'coach', name: '' };

        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        stopCoachPaymentWatcher();
        stopStudentPaymentWatchers();
        stopIncomeRecordsWatcher();
        stopOverviewForStudent();
        stopStudentTimeRefresh();
        stopStudentApprovalWatch();
        stopCoachApprovalWatcher();
        showCoachBanner('');
        resetStudentView();     // 清掉畫面，下一位登入的人不會看到前一位的資料
    }
});

// 學生資料
// ------------------------------------------------------------
// ------------------------------------------------------------
// 學生個人頁：基本資料 + 日期區間的逐堂上課明細
// ------------------------------------------------------------
let currentProfileStudent = null;

function escapeProfileText(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function setProfileEmail(email) {
    const el = document.getElementById('profile-email');
    if (!el) return;
    el.dataset.email = email || '';
    el.innerText = email || '（尚未綁定帳號）';
    el.classList.toggle('is-unbound', !email);
    refreshProfileApproval();
}

function openStudentProfile(name, data) {
    currentProfileStudent = name;

    document.getElementById('student-list-view').classList.add('hide');
    document.getElementById('student-profile-view').classList.remove('hide');

    document.getElementById('profile-name').innerText = name;
    setProfileEmail(data.email || '');
    document.getElementById('profile-price').innerText =
        data.defaultPrice !== undefined ? `$${data.defaultPrice}` : '—';

    // 預設查詢區間：本月 1 號到月底
    const now = new Date();
    document.getElementById('profile-start').value =
        toYMD(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById('profile-end').value =
        toYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    renderStudentProfileDetails();
}

window.closeStudentProfile = function () {
    currentProfileStudent = null;
    const listView = document.getElementById('student-list-view');
    const profileView = document.getElementById('student-profile-view');
    if (listView) listView.classList.remove('hide');
    if (profileView) profileView.classList.add('hide');
};

// 刪除成功後 deleteStudent 會呼叫 renderStudentDbPanel，裡面已經會回到名單；
// 按取消則會留在個人頁。
// ------------------------------------------------------------
// 教練端：學生核准
// 核准是跟著「Email＋姓名」走的：學生註冊或綁定姓名之後，要你核准，才看得到課表與收款資訊。
// ------------------------------------------------------------
let coachApprovals = {};        // 小寫 Email -> { name, approvedAt }
let coachStudentsSnap = {};     // 學生姓名 -> 資料（用來算「待核准」的人數）
let coachApprovalUnsubs = [];

function isStudentApproved(name, email) {
    if (!email) return false;
    const a = coachApprovals[String(email).toLowerCase()];
    return !!a && a.name === name;
}

function updateStudentsNavBadge() {
    const btn = document.querySelector('.coach-nav-btn[data-panel="panel-students"]');
    if (!btn) return;
    const pending = Object.entries(coachStudentsSnap)
        .filter(([name, d]) => d.email && !isStudentApproved(name, d.email)).length;
    let badge = btn.querySelector('.nav-badge');
    if (pending === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
    }
    badge.textContent = pending;
}

function refreshProfileApproval() {
    const name = currentProfileStudent;
    const statusEl = document.getElementById('profile-approval');
    const btn = document.getElementById('profile-approve-btn');
    if (!name || !statusEl || !btn) return;
    const emailEl = document.getElementById('profile-email');
    const email = ((emailEl && emailEl.dataset.email) || '').toLowerCase();
    if (!email) {
        statusEl.innerText = '尚未綁定帳號';
        statusEl.classList.add('is-pending');
        btn.classList.add('hide');
        return;
    }
    const approved = isStudentApproved(name, email);
    statusEl.innerText = approved ? '✅ 已核准（學生看得到課表與收款資訊）' : '⏳ 待核准（核准前，學生看不到課表與收款資訊）';
    statusEl.classList.toggle('is-pending', !approved);
    btn.innerText = approved ? '撤銷核准' : '✅ 核准';
    btn.classList.remove('hide');
}

function afterApprovalDataChange() {
    updateStudentsNavBadge();
    refreshProfileApproval();
    const panel = document.getElementById('panel-students');
    if (panel && panel.classList.contains('active')) renderStudentDbPanel({ keepProfile: true });
}

function startCoachApprovalWatcher() {
    stopCoachApprovalWatcher();
    coachApprovalUnsubs.push(onSnapshot(collection(db, 'approvedEmails'), (snap) => {
        const m = {};
        snap.forEach((d) => { m[d.id] = d.data(); });
        coachApprovals = m;
        afterApprovalDataChange();
    }, (err) => console.error('監聽核准記錄失敗:', err)));
    coachApprovalUnsubs.push(onSnapshot(collection(db, 'students'), (snap) => {
        const m = {};
        snap.forEach((d) => { m[d.id] = d.data(); });
        coachStudentsSnap = m;
        afterApprovalDataChange();
    }, (err) => console.error('監聽學生資料失敗:', err)));
}

function stopCoachApprovalWatcher() {
    coachApprovalUnsubs.forEach((fn) => fn());
    coachApprovalUnsubs = [];
    coachApprovals = {};
    coachStudentsSnap = {};
    updateStudentsNavBadge();
}

// 個人頁的「核准／撤銷核准」按鈕
window.toggleStudentApproval = async function () {
    const name = currentProfileStudent;
    if (!name) return;
    const emailEl = document.getElementById('profile-email');
    const email = ((emailEl && emailEl.dataset.email) || '').toLowerCase();
    if (!email) { alert('這位學生還沒有綁定帳號，沒有可以核准的對象'); return; }

    try {
        if (isStudentApproved(name, email)) {
            if (!confirm(`確定要撤銷「${name}」（${email}）的核准嗎？\n撤銷後他看不到課表和收款資訊，直到你再次核准。`)) return;
            await deleteDoc(doc(db, 'approvedEmails', email));
        } else {
            await setDoc(doc(db, 'approvedEmails', email), { name, approvedAt: new Date().toISOString() });
        }
    } catch (err) {
        console.error('核准操作失敗:', err);
        alert('操作失敗，請稍後再試');
    }
};

// 學生清單上方的「全部核准」：一次核准所有已綁定、但還沒核准的學生（建議先看過名單）
window.approveAllBoundStudents = async function () {
    const pending = Object.entries(coachStudentsSnap)
        .filter(([name, d]) => d.email && !isStudentApproved(name, d.email));
    if (pending.length === 0) { alert('目前沒有待核准的學生'); return; }

    const list = pending.map(([name, d]) => `・${name}（${String(d.email).toLowerCase()}）`).join('\n');
    if (!confirm(`確定要核准以下 ${pending.length} 位學生嗎？\n\n${list}\n\n核准後他們就看得到自己的課表和收款資訊。請先確認每個 Email 都是你認識的學生。`)) return;

    let ok = 0, failed = 0;
    for (const [name, d] of pending) {
        try {
            await setDoc(doc(db, 'approvedEmails', String(d.email).toLowerCase()), { name, approvedAt: new Date().toISOString() });
            ok++;
        } catch (err) {
            failed++;
            console.error(`核准 ${name} 失敗:`, err);
        }
    }
    alert(`已核准 ${ok} 位${failed ? `，失敗 ${failed} 位` : ''}`);
};

// 教練端：修改（或解除）這位學生綁定的登入 Email
window.editStudentEmail = async function () {
    const name = currentProfileStudent;
    if (!name) return;
    const emailEl = document.getElementById('profile-email');
    const current = (emailEl && emailEl.dataset.email) || '';

    const input = prompt(`請輸入「${name}」的登入 Email（會自動轉成小寫）。\n留白代表解除綁定，學生之後登入會看不到課表。`, current);
    if (input === null) return;                       // 按取消
    const email = input.trim().toLowerCase();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Email 格式不正確'); return; }
    if (email === current) return;
    if (!email && !confirm(`確定要解除「${name}」的帳號綁定嗎？\n解除後他登入會看不到課表，需要重新綁定。`)) return;

    try {
        // 同一個 Email 只能綁一位學生：已經綁在別人身上，要先解除那一位
        if (email) {
            const dup = await getDocs(query(collection(db, 'students'), where('email', '==', email)));
            const others = dup.docs.filter((d) => d.id !== name);
            if (others.length > 0) {
                const names = others.map((d) => d.id).join('、');
                if (!confirm(`這個 Email 目前綁在「${names}」。\n確定改綁到「${name}」嗎？（會解除「${names}」的綁定）`)) return;
                for (const d of others) await setDoc(doc(db, 'students', d.id), { email: '' }, { merge: true });
            }
        }
        await setDoc(doc(db, 'students', name), { email, isStudent: true }, { merge: true });
        // 核准是跟著「Email＋姓名」走的：舊 Email 的核准撤掉；你親自設定的新 Email 視為已信任，直接核准
        const oldApproval = current ? coachApprovals[current] : null;
        if (current && oldApproval && oldApproval.name === name) await deleteDoc(doc(db, 'approvedEmails', current));
        if (email) await setDoc(doc(db, 'approvedEmails', email), { name, approvedAt: new Date().toISOString(), by: 'coach' });
        setProfileEmail(email);
        renderStudentDbPanel({ keepProfile: true });
        alert(email ? `✅ 已綁定：${email}` : '已解除綁定');
    } catch (err) {
        console.error('修改 Email 失敗:', err);
        alert('修改失敗，請稍後再試');
    }
};

window.deleteStudentFromProfile = function () {
    if (currentProfileStudent) deleteStudent(currentProfileStudent);
};

window.renderStudentProfileDetails = function () {
    if (!currentProfileStudent) return;

    const startVal = document.getElementById('profile-start').value;
    const endVal = document.getElementById('profile-end').value;
    const summaryEl = document.getElementById('profile-summary');
    const listEl = document.getElementById('profile-detail-list');

    listEl.innerHTML = '';

    if (!startVal || !endVal) {
        summaryEl.innerText = '請選擇開始與結束日期';
        return;
    }
    if (startVal > endVal) {
        summaryEl.innerText = '開始日期不能晚於結束日期';
        return;
    }
    if (typeof window.getStudentLessonDetails !== 'function') {
        summaryEl.innerText = '資料尚未載入完成，請稍後再試';
        return;
    }

    const lessons = window.getStudentLessonDetails(currentProfileStudent, startVal, endVal);
    if (lessons.length === 0) {
        summaryEl.innerText = '這段期間沒有上課紀錄';
        return;
    }

    // 統計只算已上完的課
    const done = lessons.filter(l => l.completed);
    const upcomingCount = lessons.length - done.length;
    const totalMinutes = done.reduce((sum, l) => sum + l.minutes, 0);
    const totalMoney = done.reduce((sum, l) => sum + l.money, 0);

    let summary = `已上完 <strong>${done.length}</strong> 堂（${Number((totalMinutes / 60).toFixed(2))} 小時），總金額 <strong>$${Math.round(totalMoney).toLocaleString()}</strong>`;
    if (upcomingCount > 0) {
        summary += `　另有 ${upcomingCount} 堂尚未上課，不列入統計`;
    }
    summaryEl.innerHTML = summary;

    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const spansYears = startVal.slice(0, 4) !== endVal.slice(0, 4);

    listEl.innerHTML = lessons.map(l => {
        const d = new Date(`${l.dateStr}T00:00:00`);
        const md = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        const dateLabel = `${spansYears ? d.getFullYear() + '/' : ''}${md} (${weekDays[d.getDay()]})`;
        const hours = Number((l.minutes / 60).toFixed(2));

        return `
            <div class="lesson-item ${l.completed ? '' : 'is-upcoming'}">
                <span class="lesson-date">${dateLabel}</span>
                <span class="lesson-time">${escapeProfileText(l.start)}-${escapeProfileText(l.end)}（${hours} 小時）</span>
                <span class="lesson-loc">📍 ${escapeProfileText(l.loc)}</span>
                <span class="lesson-money">$${Math.round(l.money).toLocaleString()}</span>
                ${l.completed ? '' : '<span class="lesson-tag">未上</span>'}
            </div>`;
    }).join('');
};

// 取得學生資料
async function renderStudentDbPanel(opts = {}) {
    const listEl = document.getElementById('student-db-list');
    const template = document.getElementById('student-row-template');

    if (!listEl || !template) return;
    if (!opts.keepProfile) closeStudentProfile();   // 修改 Email 後重畫清單時，不要把人踢出個人頁
    

    listEl.innerHTML = '<p class="no-data-hint">讀取中...</p>';

    try {
        const snap = await getDocs(collection(db, "students"));
        if (snap.empty) {
            listEl.innerHTML = '<p class="no-data-hint">目前還沒有學生資料，點右上角「＋ 新增學生」開始建立</p>';
            return;
        }

        const rows = [];

        snap.forEach((docSnap) => {
            const data = docSnap.data();
            const name = docSnap.id;

            if (!data.email && !data.isStudent) return;

            const emailText = data.email ? data.email : '尚未綁定帳號';
            const priceText = data.defaultPrice !== undefined ? `$${data.defaultPrice}` : '—';
            const row = template.content.cloneNode(true);

            const rowWrap = row.querySelector('.db-row-wrap');
            const rowClickable = row.querySelector('.db-row-clickable');
            const detail = row.querySelector('.db-detail');

            const nameEl = row.querySelector('.db-name');
            const metaEl = row.querySelector('.db-meta');

            const deleteBtn = row.querySelector('.delete-student-btn');
            
            nameEl.textContent = `▸ ${name}`;
            const approved = isStudentApproved(name, data.email);
            const approvalText = data.email ? (approved ? ' · ✅ 已核准' : ' · ⏳ 待核准') : '';
            metaEl.textContent =
                `${emailText} · 預設學費 ${priceText}${approvalText}`;
            metaEl.classList.toggle('is-unbound', !data.email);   // 沒綁定帳號的學生用橘色提醒
            metaEl.classList.toggle('is-pending', !!data.email && !approved);   // 已綁定但還沒核准，也用橘色提醒

            // 點擊學生列 → 展開 / 收合詳細資料
            rowClickable.addEventListener('click', () => {
                openStudentProfile(name, data);
            });


            // 刪除學生
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteStudent(name);
            });


            rows.push(row);
        });


        if (rows.length === 0) {
            listEl.innerHTML =
                '<p class="no-data-hint">目前還沒有學生資料，點右上角「＋ 新增學生」開始建立</p>';
            return;
        }


        // 清空原本內容
        listEl.innerHTML = '';

        // 一次加入所有學生
        rows.forEach((row) => {
            listEl.appendChild(row);
        });

    } catch (err) {

        console.error("讀取學生資料庫失敗:", err);

        listEl.innerHTML =
            '<p class="no-data-hint">讀取失敗，請重新整理再試一次</p>';
    }
}

// ------------------------------------------------------------
// 資訊總覽：停課公告 + 下週時段 + 工時 + 收入
// ------------------------------------------------------------
const OVERVIEW_DOC_ID = 'content';

// 暫存：只存草稿，學生端不會看到變化
window.saveOverviewDraft = async function () {
    const notice = document.getElementById('overview-notice-input').value;
    const slots = document.getElementById('overview-slots-input').value;
    try {
        await setDoc(doc(db, "overview", OVERVIEW_DOC_ID), {
            noticeDraft: notice,
            slotsDraft: slots,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        alert('已暫存');
    } catch (err) {
        console.error('暫存失敗:', err);
        alert('暫存失敗，請稍後再試');
    }
};

// 更新：草稿跟正式發布版一起存，學生端會立刻看到
window.publishOverview = async function () {
    const notice = document.getElementById('overview-notice-input').value;
    const slots = document.getElementById('overview-slots-input').value;
    const sure = confirm('確定要更新嗎？學生會立刻看到最新內容。');
    if (!sure) return;
    try {
        await setDoc(doc(db, "overview", OVERVIEW_DOC_ID), {
            noticeDraft: notice,
            noticeLive: notice,
            slotsDraft: slots,
            slotsLive: slots,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        alert('✅ 已更新，學生端會同步顯示');
    } catch (err) {
        console.error('更新失敗:', err);
        alert('更新失敗，請稍後再試');
    }
};

// 教練打開「總覽」分頁時，把草稿內容帶回輸入框
async function loadOverviewEditor() {
    try {
        const snap = await getDoc(doc(db, "overview", OVERVIEW_DOC_ID));
        const data = snap.exists() ? snap.data() : {};
        const noticeInput = document.getElementById('overview-notice-input');
        const slotsInput = document.getElementById('overview-slots-input');
        if (noticeInput) noticeInput.value = data.noticeDraft || '';
        if (slotsInput) slotsInput.value = data.slotsDraft || '';
    } catch (err) {
        console.error('讀取總覽草稿失敗:', err);
    }
}

// 工時／收入：用「今天」實際日期計算，不受行事曆目前瀏覽到哪一週/哪個月影響
function renderOverviewStats() {
    const courses = window.courses || [];
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    const monthData = (typeof window.calculateMonthlyData === 'function')
        ? window.calculateMonthlyData(year, month)
        : { totalMinutes: 0, totalIncome: 0 };

    const dayOfWeek = today.getDay();
    const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + offset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    let weekMinutes = 0;
    courses.forEach((course) => {
        if (!course || course.type !== 'work') return;
        const duration = Number(course.duration || 0);

        if (course.isRepeating) {
            const targetDay = (course.day === "8" ? 0 : parseInt(course.day, 10) - 1);
            const exceptions = course.exceptions || [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                if (d.getDay() !== targetDay) continue;
                const dStr = toYMD(d);
                if (exceptions.includes(dStr)) continue;
                if (course.date && dStr < course.date) continue;
                weekMinutes += duration;
            }
        } else {
            if (!course.date) return;
            const cDate = new Date(`${course.date}T00:00:00`);
            if (cDate >= monday && cDate <= sunday) weekMinutes += duration;
        }
    });

    const weekEl = document.getElementById('overview-week-hours');
    const monthEl = document.getElementById('overview-month-hours');
    const incomeEl = document.getElementById('overview-month-income');
    if (weekEl) weekEl.innerText = (weekMinutes / 60).toFixed(1);
    if (monthEl) monthEl.innerText = (monthData.totalMinutes / 60).toFixed(1);
    if (incomeEl) incomeEl.innerText = Math.round(monthData.totalIncome).toLocaleString();
}

// 導覽列點「總覽」時會呼叫這個（你貼的程式碼裡已經有呼叫 window.renderOverviewPanel 的地方了）
window.renderOverviewPanel = function () {
    loadOverviewEditor();
    renderOverviewStats();
    if (typeof window.renderTodaySchedule === 'function') {
        window.renderTodaySchedule();
    }
    loadPaymentSettingsEditor();
    updateMaintenanceHint();
};

// ------------------------------------------------------------
// 資料維護：補齊既有課程、收款紀錄的「學生基本姓名」欄位（studentBase）。
// 學生端用這個欄位精確比對，Firestore 規則也靠它判斷「這筆是不是你的」。
// ------------------------------------------------------------
function updateMaintenanceHint() {
    const el = document.getElementById('maintenance-hint');
    if (!el) return;
    const missing = (window.courses || []).filter((c) => c && c.name && !c.studentBase).length;
    el.innerText = missing > 0
        ? `目前有 ${missing} 筆課程需要補齊（補齊前，學生端看不到這些課程）。`
        : '課程資料都已補齊 ✅（收款紀錄請按下面的按鈕一起檢查）';
}

window.backfillStudentBase = async function () {
    if (!currentUser || currentUser.role !== 'coach') return;
    const resultEl = document.getElementById('maintenance-result');
    const btn = document.getElementById('maintenance-btn');
    const setMsg = (t) => { if (resultEl) resultEl.innerText = t; };
    if (btn) btn.disabled = true;
    setMsg('補齊中，請稍候…');

    const fix = async (colName, nameField) => {
        const snap = await getDocs(collection(db, colName));
        const todo = [];
        let alreadyOk = 0, noName = 0;
        snap.forEach((d) => {
            const x = d.data();
            if (x.studentBase) { alreadyOk++; return; }
            if (!x[nameField]) { noName++; return; }
            todo.push({ id: d.id, base: window.baseStudentName(x[nameField]) });
        });
        let patched = 0, failed = 0;
        for (const t of todo) {
            try { await setDoc(doc(db, colName, t.id), { studentBase: t.base }, { merge: true }); patched++; }
            catch (err) { failed++; console.error(`補齊 ${colName}/${t.id} 失敗:`, err); }
        }
        return { total: snap.size, patched, alreadyOk, noName, failed };
    };

    // 學生帳號：文件 ID 帶括號、而且已經綁了 Email 的舊帳號（例如「學生D(個別)」），
    // 在新規則下找不到對應的基本姓名文件，會讀不到任何資料。這裡把它們改綁到不含括號的姓名。
    const fixStudents = async () => {
        const snap = await getDocs(collection(db, 'students'));
        const byId = new Map();
        snap.forEach((d) => byId.set(d.id, d.data()));
        let moved = 0;
        const conflicts = [];
        for (const [id, x] of byId) {
            if (!x.email) continue;
            const base = window.baseStudentName(id);
            if (base === id) continue;
            const target = byId.get(base);
            if (target && target.email && target.email !== x.email) {
                conflicts.push(`${id}（「${base}」已經綁了另一個 Email）`);
                continue;
            }
            try {
                await setDoc(doc(db, 'students', base), { email: x.email, isStudent: true }, { merge: true });
                await setDoc(doc(db, 'students', id), { email: '' }, { merge: true });   // 舊文件解除綁定，登入時才不會查到兩份
                moved++;
            } catch (err) {
                console.error(`改綁學生帳號 ${id} 失敗:`, err);
                conflicts.push(`${id}（寫入失敗）`);
            }
        }
        return { moved, conflicts };
    };

    try {
        const st = await fixStudents();
        const ev = await fix('events', 'name');
        const inc = await fix('incomeRecords', 'studentName');
        const fmt = (label, r) => `${label} ${r.total} 筆：補齊 ${r.patched}、原本就有 ${r.alreadyOk}${r.noName ? `、缺姓名略過 ${r.noName}` : ''}${r.failed ? `、失敗 ${r.failed}` : ''}`;
        setMsg(`完成。${fmt('課程', ev)}；${fmt('收款紀錄', inc)}；學生帳號 ${st.moved} 個已改綁到不含括號的姓名${st.conflicts.length ? `。需要你手動處理：${st.conflicts.join('、')}` : ''}`);
    } catch (err) {
        console.error('補齊失敗:', err);
        setMsg('補齊失敗：' + (err && err.message ? err.message : err));
    } finally {
        if (btn) btn.disabled = false;
        updateMaintenanceHint();
    }
};

// 收入數字的模糊/顯示切換（跟側邊欄那個是同一套邏輯，另外獨立一份給總覽頁用）
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn2 = document.getElementById('overview-income-toggle');
    const incomeSpan2 = document.getElementById('overview-month-income');
    if (toggleBtn2 && incomeSpan2) {
        toggleBtn2.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isRevealed = incomeSpan2.classList.toggle('revealed');
            toggleBtn2.innerHTML = isRevealed ? '隱藏' : '查看';
        });
    }
});

// 學生端：即時監聽公告/時段，教練一按「更新」就會同步顯示
let overviewUnsub = null;

function stopOverviewForStudent() {
    if (overviewUnsub) { overviewUnsub(); overviewUnsub = null; }
}

function watchOverviewForStudent() {
    stopOverviewForStudent();   // 避免每登入一次就多一個監聽器
    overviewUnsub = onSnapshot(doc(db, "overview", OVERVIEW_DOC_ID), (snap) => {
        const data = snap.exists() ? snap.data() : {};

        const noticeEl = document.getElementById('student-notice-content');
        if (noticeEl) noticeEl.innerText = data.noticeLive || '目前沒有公告';

        const slotsEl = document.getElementById('student-slots-content');
        if (slotsEl) {
            const lines = (data.slotsLive || '').split('\n').map((x) => x.trim()).filter(Boolean);
            slotsEl.innerHTML = '';
            if (lines.length === 0) {
                const p = document.createElement('p');
                p.innerText = '目前沒有公告時段';
                slotsEl.appendChild(p);
            } else {
                // 用文字節點寫入，教練輸入 < > 之類的符號也不會破版
                lines.forEach((line) => {
                    const chip = document.createElement('div');
                    chip.className = 'slot-chip';
                    chip.innerText = line;
                    slotsEl.appendChild(chip);
                });
            }
        }
    }, (err) => {
        console.error('監聽總覽資料失敗:', err);
        const noticeEl = document.getElementById('student-notice-content');
        if (noticeEl) noticeEl.innerText = '公告暫時讀取失敗，請檢查網路後重新整理頁面';
    });
}


// 新增學生
window.addStudent = async function () {
    const nameInput = prompt("請輸入學生姓名：");
    if (!nameInput || !nameInput.trim()) return;
    const name = nameInput.trim();

    try {
        const ref = doc(db, "students", name);
        const existing = await getDoc(ref);
        if (existing.exists()) {
            alert("這個姓名已經存在學生名單裡了，如果是同一位學生，不需要重複新增");
            return;
        }

        await setDoc(ref, { isStudent: true }, { merge: true });
        alert(`✅ 已新增學生：${name}`);
        renderStudentDbPanel();
    } catch (err) {
        console.error("新增學生失敗:", err);
        alert("新增失敗，請稍後再試");
    }
};

// 刪除學生: 只會刪除 students collection 裡的對照資料，不會動到已經排好的課程紀錄
window.deleteStudent = async function (name) {
    // 已經綁定登入帳號的學生，刪除後他還是能登入、卻會看不到課表，先講清楚
    let boundEmail = '';
    try {
        const snap = await getDoc(doc(db, "students", name));
        if (snap.exists()) boundEmail = snap.data().email || '';
    } catch (_) { /* 讀不到就當作沒綁定 */ }
    const warn = boundEmail
        ? `\n\n⚠️ 這位學生已經綁定登入帳號（${boundEmail}）。刪除後他還是可以登入，但會看到「找不到你的學生資料」，需要重新綁定姓名。`
        : '';

    const sure = confirm(
        `確定要刪除學生「${name}」嗎？\n\n這只會刪除他的帳號對照資料，不會刪除他已經排過的課程（如果要清課表要另外手動刪除）。${warn}`
    );
    if (!sure) return;

    try {
        await deleteDoc(doc(db, "students", name));
        if (boundEmail) {
            const approval = coachApprovals[boundEmail.toLowerCase()];
            if (approval && approval.name === name) await deleteDoc(doc(db, 'approvedEmails', boundEmail.toLowerCase()));
        }
        alert(`已刪除學生：${name}`);
        renderStudentDbPanel();
    } catch (err) {
        console.error("刪除學生失敗:", err);
        alert("刪除失敗，請稍後再試");
    }
};



// 課程本身的資料存取
// ------------------------------------------------------------

//更新行程
window.uploadEvent = async (eventData) => {
    try {
        let currentPrice = parseInt(eventData.price, 10);
        if (isNaN(currentPrice)) {
            const lastCourse = (window.courses || []).find(c => c.name === eventData.name && c.price);
            currentPrice = lastCourse ? parseInt(lastCourse.price, 10) : 600;
        }

        let emailToUpload = "";

        if (eventData.type === 'work') {
            const studentRef = doc(db, "students", eventData.name); // 假設文件 ID 就是姓名
            const studentSnap = await getDoc(studentRef);
            const existingData = studentSnap.exists() ? studentSnap.data() : {};

            if (existingData.email) {
                emailToUpload = existingData.email;
            } else {
                console.warn(`⚠️ 找不到學生 [${eventData.name}] 的對照 Email，已自動預設為空字串。`);
            }

            await setDoc(studentRef, { defaultPrice: currentPrice, isStudent: true }, { merge: true });

            console.log(`🚀 雲端已記憶 ${eventData.name} 的預設學費為: ${currentPrice} 元`);
        }

        const eventId = eventData.id.toString();

        const finalPayload = {
            ...eventData,
            price: currentPrice,
            studentEmail: emailToUpload,
            studentBase: window.baseStudentName(eventData.name)   // 學生端與 Firestore 規則用它判斷「這堂課是誰的」
        };

        await setDoc(doc(db, "events", eventId), finalPayload);
        console.log(`✅ 課程 [${eventData.name}] 金額 $${currentPrice} 已成功寫入雲端！`);
        
    } catch (e) {
        console.error("❌ 上傳失敗:", e);
    }
};

//刪除行程
window.removeEventFromCloud = async (eventId) => {
    try {
        if (!eventId) return;
        
        const docRef = doc(db, "events", eventId.toString());
        await deleteDoc(docRef);
        
        console.log(`🗑️ 雲端行程 [ID: ${eventId}] 已成功從 Firestore 抹除`);
    } catch (e) {
        console.error("❌ 雲端刪除失敗:", e);
    }
};

// 跟 Firestore 同步課表資料
// 教練端畫面最上方的提示條（讀取失敗時顯示）；傳空字串就移除
function showCoachBanner(text) {
    let el = document.getElementById('coach-banner');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
        const host = document.getElementById('coach-view');
        if (!host) return;
        el = document.createElement('div');
        el.id = 'coach-banner';
        el.className = 'coach-banner';
        host.insertBefore(el, host.firstChild);
    }
    el.innerText = text;
}

function startLiveSync() {
    console.log("🔒 啟動全域資料同步 (教練視角)...");
    if (unsubscribe) unsubscribe(); 

    const q = query(collection(db, "events"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const myEvents = [];
        snapshot.forEach((doc) => {
            const data = doc.data();

            let itemPrice = data.price !== undefined ? Number(data.price) : undefined;
            myEvents.push({ 
                ...data, 
                id: data.id ? data.id.toString() : doc.id,
                price: itemPrice // 強制導正型態
            });
        });


        console.log("📥 教練成功同步課表數量:", myEvents.length);
        showCoachBanner('');   // 讀取成功，清掉之前的錯誤提示

        // 強制確保全域與本地變數同時拿到最新的真相來源
        window.courses = myEvents;
        if (typeof courses !== 'undefined') {
            courses = myEvents;
        }

        // 🎨 渲染日曆 UI
        if (window.updateCalendarUI) {
            window.updateCalendarUI(myEvents);
            renderStudentNextClassCard();
        }

        // 課表資料到了（或有變動）時，如果人正在總覽頁，就更新工時與收入
        const overviewPanel = document.getElementById('panel-overview');
        if (overviewPanel && overviewPanel.classList.contains('active')) {
            renderOverviewStats();
            updateMaintenanceHint();
        }
                
        // 📊 同步更新左側 Sidebar 的統計數據與時數
        if (window.updateStats) {
            window.updateStats();
        } else if (window.renderAll) {
            window.renderAll();
        }
    }, (err) => {
        console.error('讀取課表失敗:', err);
        showCoachBanner(err && err.code === 'permission-denied'
            ? '資料讀取被拒絕。請先關掉其他分頁（尤其是學生帳號的分頁）再重新整理；如果還是一樣，請確認 Firestore 規則裡的教練 Email。'
            : '課表讀取失敗，請檢查網路後重新整理頁面。');
    });
}

function renderStudentNextClassCard() {
    if (!currentUser || currentUser.role !== 'student' || !currentUser.name) return;
    const el = document.getElementById('student-next-class');
    if (!el) return;

    const next = (typeof window.findNextClassForStudentHome === 'function')
        ? window.findNextClassForStudentHome(currentUser.name)
        : null;

    if (!next) {
        el.innerText = '尚無排定課程';
        return;
    }

    const d = new Date(`${next.dateStr}T00:00:00`);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const loc = next.course.loc ? `（${next.course.loc}）` : '';
    const label = (typeof window.courseTypeLabel === 'function') ? window.courseTypeLabel(next.course.name) : '';
    el.innerText = `${d.getMonth() + 1}/${d.getDate()} (${weekDays[d.getDay()]}) ${next.course.start} - ${next.course.end}${loc}${label ? `（${label}）` : ''}${next.ongoing ? ' · 上課中' : ''}`;
}


// ------------------------------------------------------------
// 學生端：登入、登出時把畫面清成「讀取中」，並回到首頁分頁
// （避免共用手機、或同一個分頁換帳號時，看到上一位的資料）
// ------------------------------------------------------------
let studentDayDetailDefaultHtml = null;

function resetStudentView() {
    window.courses = undefined;
    if (typeof window.resetStudentCalendarState === 'function') window.resetStudentCalendarState();

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('student-name-display', '同學');
    setText('student-total-hours', '—');
    setText('student-class-count', '—');
    setText('student-next-class', '讀取中...');
    setText('student-notice-content', '讀取中...');
    setText('student-slots-content', '讀取中...');
    setText('student-history-result', '選擇開始與結束日期後點「查詢」');
    setText('pay-amount', '$0');
    setText('pay-hours', '');

    const statusEl = document.getElementById('student-payment-status');
    if (statusEl) { statusEl.innerText = '讀取中…'; statusEl.style.color = '#90a4ae'; }

    ['student-month-grid', 'progress-chart', 'pay-breakdown', 'pay-method-area', 'pay-report-area', 'pay-status-banner']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });

    const dayDetailEl = document.getElementById('student-day-detail');
    if (dayDetailEl) {
        if (studentDayDetailDefaultHtml === null) studentDayDetailDefaultHtml = dayDetailEl.innerHTML;
        else dayDetailEl.innerHTML = studentDayDetailDefaultHtml;
    }

    ['student-history-start', 'student-history-end'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // 月份、年份、分頁都回到預設（今天所在的月份、首頁）
    const now = new Date();
    payYear = now.getFullYear();
    payMonthIdx = now.getMonth();
    payCurrentAmount = 0;
    document.querySelectorAll('.student-nav-btn[data-panel]').forEach((b) =>
        b.classList.toggle('active', b.dataset.panel === 'panel-student-home'));
    document.querySelectorAll('.student-panel').forEach((pn) =>
        pn.classList.toggle('active', pn.dataset.panelId === 'panel-student-home'));

    clearStudentBanner();
    const dueCard = document.getElementById('student-due-card');
    if (dueCard) dueCard.remove();
    studentPendingReason = null;
}

// 學生首頁最上方的提示條。kind：'error'（讀取失敗）、'notfound'（找不到學生資料）、'offline'（離線）。
// 傳空字串就移除。
function showStudentBanner(text, kind = 'error') {
    let el = document.getElementById('student-banner');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
        const host = document.querySelector('#panel-student-home .panel-inner') || document.getElementById('panel-student-home');
        if (!host) return;
        el = document.createElement('div');
        el.id = 'student-banner';
        el.className = 'student-banner';
        host.insertBefore(el, host.firstChild);
    }
    el.dataset.kind = kind;
    el.innerText = text;
}

// 只清掉指定種類的提示（kind 省略就全部清掉）
function clearStudentBanner(kind) {
    const el = document.getElementById('student-banner');
    if (!el) return;
    if (!kind || el.dataset.kind === kind) el.remove();
}

// 離線時提醒學生「畫面上是上次載入的資料」；恢復連線就自動收起
function updateOfflineBanner() {
    if (!currentUser || currentUser.role !== 'student') return;
    if (navigator.onLine === false) showStudentBanner('目前沒有網路連線，畫面上是上次載入的資料。', 'offline');
    else {
        clearStudentBanner('offline');
        if (studentPendingReason && !document.getElementById('student-banner') && currentUser && currentUser.name) {
            showStudentPendingState(currentUser.name, studentPendingReason);
        }
    }
}
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('online', () => {
    updateOfflineBanner();
    // 之前因為沒網路而找不到學生資料時，恢復連線後自動重試
    if (currentUser && currentUser.role === 'student' && !currentUser.name && auth.currentUser) {
        enterStudentMode(auth.currentUser);
    }
});

// ------------------------------------------------------------
// 學生自己重新綁定姓名：登入後找不到學生資料時，在提示條下面放一個輸入框。
// 做的事跟註冊時一樣（把這個登入 Email 綁到一個姓名上），所以安全性也一樣：
// 已經綁了別的 Email 的姓名，Firestore 規則會拒絕。
// ------------------------------------------------------------
let rebinding = false;

function showStudentRebindForm() {
    const banner = document.getElementById('student-banner');
    if (!banner || banner.dataset.kind !== 'notfound') return;

    const wrap = document.createElement('div');
    wrap.id = 'student-rebind';
    wrap.className = 'student-rebind';

    const input = document.createElement('input');
    input.id = 'student-rebind-name';
    input.type = 'text';
    input.placeholder = '輸入你的姓名';
    input.autocomplete = 'off';
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') rebindStudentName(input.value); });

    const btn = document.createElement('button');
    btn.id = 'student-rebind-btn';
    btn.type = 'button';
    btn.innerText = '綁定帳號';
    btn.addEventListener('click', () => rebindStudentName(input.value));

    const msg = document.createElement('div');
    msg.id = 'student-rebind-msg';
    msg.className = 'student-rebind-msg';

    wrap.appendChild(input);
    wrap.appendChild(btn);
    wrap.appendChild(msg);
    banner.appendChild(wrap);
}

async function rebindStudentName(typedName) {
    if (rebinding) return;
    const user = auth.currentUser;
    if (!user || !user.email) return;

    const msgEl = document.getElementById('student-rebind-msg');
    const btn = document.getElementById('student-rebind-btn');
    const say = (t) => { if (msgEl) msgEl.innerText = t; };
    const takenMsg = '這個姓名已經被其他帳號綁定了。請確認姓名是否正確，或聯絡教練。';

    // 打成「測試3(個別)」也一律綁到「測試3」
    const name = window.baseStudentName((typedName || '').trim());
    if (!name) { say('請先輸入你的姓名'); return; }
    const email = user.email.toLowerCase();

    rebinding = true;
    if (btn) btn.disabled = true;
    say('綁定中…');
    try {
        // 先看這個姓名有沒有已經綁了別人（讀不到就略過，交給 Firestore 規則把關）
        try {
            const snap = await getDoc(doc(db, 'students', name));
            const bound = snap.exists() ? (snap.data().email || '') : '';
            if (bound && bound.toLowerCase() !== email) { say(takenMsg); return; }
        } catch (_) { /* 讀不到就直接交給規則 */ }

        await setDoc(doc(db, 'students', name), { email, isStudent: true }, { merge: true });
    } catch (err) {
        console.error('重新綁定失敗:', err);
        say(err && err.code === 'permission-denied'
            ? takenMsg
            : (navigator.onLine === false ? '目前沒有網路，請連線後再試。' : '綁定失敗，請稍後再試。'));
        return;
    } finally {
        rebinding = false;
        if (btn) btn.disabled = false;
    }

    await enterStudentMode(user);   // 綁定好了，重新載入這位學生的資料
    if (currentUser && currentUser.name) {
        alert(`✅ 已綁定為「${name}」。如果看不到課程，請確認這個姓名跟教練登記的是否一致。`);
    }
}

// ------------------------------------------------------------
// 學生端：時間到了自動更新（上完課變灰、下次上課換下一堂、跨日重算）
// 在「今天下一個開始或下課的時間點」設定計時器，到點才重畫，不用一直輪詢。
// ------------------------------------------------------------
let studentTimeTimer = null;

function refreshStudentTimeViews() {
    if (!currentUser || currentUser.role !== 'student') return;
    renderAll();                         // 首頁「已上完」時數
    renderStudentNextClassCard();
    refreshStudentPaymentViews();        // 首頁費用卡、繳費頁
    if (typeof window.renderStudentMonthCalendar === 'function') window.renderStudentMonthCalendar();
    if (typeof window.renderProgressChart === 'function') window.renderProgressChart();
}

function stopStudentTimeRefresh() {
    clearTimeout(studentTimeTimer);
    studentTimeTimer = null;
}

function scheduleStudentTimeRefresh() {
    stopStudentTimeRefresh();
    if (!currentUser || currentUser.role !== 'student' || !currentUser.name) return;

    const now = new Date();
    const todayStr = toYMD(now);
    // 預設等到明天 00:00:01（跨日也要重算「今天」）
    let next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);

    if (typeof window.getStudentLessonDetails === 'function') {
        window.getStudentLessonDetails(currentUser.name, todayStr, todayStr, true).forEach((l) => {
            [l.start, l.end].forEach((t) => {
                if (!t) return;
                const at = new Date(`${todayStr}T${t}:00`);
                at.setSeconds(at.getSeconds() + 1);   // 晚 1 秒，確保「下課時間 <= 現在」成立
                if (at > now && at < next) next = at;
            });
        });
    }

    studentTimeTimer = setTimeout(() => {
        refreshStudentTimeViews();
        scheduleStudentTimeRefresh();
    }, Math.max(1000, next - now));
}

// 手機鎖屏或切到背景時計時器會被暫停：回到畫面時立刻重算一次
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!currentUser || currentUser.role !== 'student') return;
    refreshStudentTimeViews();
    scheduleStudentTimeRefresh();
});

// 同步student view的資料
function startStudentLiveSync(studentName) {
    console.log(`🔒學生模式：正在同步 [${studentName}] 的課程...`);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    if (!studentName) {
        if (window.updateCalendarUI) window.updateCalendarUI([]);
        // 沒有對應的學生資料：把「讀取中」改成明確的空狀態，避免學生以為是網路慢、一直在等
        const nextEl = document.getElementById('student-next-class');
        if (nextEl) nextEl.innerText = '—';
        const statusEl = document.getElementById('student-payment-status');
        if (statusEl) { statusEl.innerText = '—'; statusEl.style.color = '#90a4ae'; }
        return;
    }

    const baseName = window.baseStudentName(studentName);
    const q = query(collection(db, "events"), where("studentBase", "==", baseName));

    unsubscribe = onSnapshot(q, (snapshot) => {
        const myEvents = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!window.belongsToStudent(data.name, studentName)) return;   // 名字開頭相同但不是同一個人（例如「王小明明」）
            myEvents.push({ ...data, id: data.id ? data.id.toString() : docSnap.id });
        });

        clearStudentBanner('error');   // 讀取成功，清掉之前的讀取失敗提示

        if (window.updateCalendarUI) {
            window.updateCalendarUI(myEvents);
        }

        renderStudentNextClassCard();
        refreshStudentPaymentViews();

        if (typeof window.renderStudentMonthCalendar === 'function') {
            window.renderStudentMonthCalendar();
        }
        if (typeof window.renderProgressChart === 'function') {
            window.renderProgressChart();
        }

        scheduleStudentTimeRefresh();
    }, (err) => {
        console.error('讀取課表失敗:', err);
        showStudentBanner('課表讀取失敗，請檢查網路後重新整理頁面。', 'error');
    });
}

// 本月收入畫面
// 產生「收入紀錄」在 Firestore 中使用的唯一 ID
function getIncomeRecordId(year, month, studentName) {
    const monthText = String(month + 1).padStart(2, '0');
    return `${currentUser.uid}_${year}-${monthText}_${encodeURIComponent(studentName)}`;
}

// 設定指定學生、指定月份的「收款狀態」
window.setIncomePaidStatus = async function (year, month, studentName, isPaid) {
    if (!currentUser.uid) {
        console.error('❌ 尚未登入，無法儲存收款紀錄');
        return false;
    }

    try {
        const recordId = getIncomeRecordId(year, month, studentName);
        await setDoc(doc(db, "incomeRecords", recordId),{
                coachUid: currentUser.uid,
                year: year,
                month: month + 1,
                studentName: studentName,
                studentBase: window.baseStudentName(studentName),
                isPaid: isPaid,
                updatedAt: new Date().toISOString()
            },
            { merge: true }
        );

        console.log(
            `💰 收款紀錄已更新：${year}-${String(month + 1).padStart(2, '0')} / ${studentName} / ${isPaid ? '已收款' : '待收款'}`
        );

        await syncReportStatusWithPaid(year, month, studentName, isPaid);

        return true;

    } catch (error) {
        console.error("❌ 儲存收款紀錄失敗:", error);
        return false;
    }
};


// 自動記憶上課價錢
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-income-btn');
    const incomeSpan = document.getElementById('month-income');

    if (toggleBtn && incomeSpan) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isRevealed = incomeSpan.classList.toggle('revealed');
            if (isRevealed) {
                toggleBtn.innerHTML = "隱藏";
            } else {
                toggleBtn.innerHTML = "查看";
            }
        });
    }

    // 當輸入/選擇學生姓名時，自動從 Firestore 撈出並帶入預設學費
    const studentNameInput = document.getElementById('m-name');
    const priceInput = document.getElementById('m-price');

    if (studentNameInput && priceInput) {
        studentNameInput.addEventListener('input', async (e) => {
            const studentName = e.target.value.trim();
            
            if (!studentName) {
                priceInput.value = ''; // 名字被刪光時，清空價格
                return;
            }

            try {
                const studentRef = doc(db, "students", studentName);
                const studentSnap = await getDoc(studentRef);

                if (studentSnap.exists() && studentSnap.data().defaultPrice !== undefined) {
                    priceInput.value = studentSnap.data().defaultPrice;
                    console.log(`🎯 自動帶入 ${studentName} 的預設學費: ${studentSnap.data().defaultPrice}`);
                }
            } catch (error) {
                console.error("撈取學生預設學費失敗:", error);
            }
        });
    }
});



const navBtns =
    document.querySelectorAll('.coach-nav-btn');

// 登出
navBtns.forEach((btn) => {

    btn.addEventListener('click', async () => {

        const targetPanelId =
            btn.dataset.panel;

        navBtns.forEach((b) =>
            b.classList.remove('active')
        );

        btn.classList.add('active');

        document
            .querySelectorAll('.coach-panel')
            .forEach((panel) => {

                panel.classList.toggle(
                    'active',
                    panel.dataset.panelId === targetPanelId
                );

            });

        if (targetPanelId === 'panel-income' &&
            typeof window.renderIncomePanel === 'function') {

            window.renderIncomePanel();
        }

        if (targetPanelId === 'panel-students') {
            renderStudentDbPanel();
        }

        if (targetPanelId === 'panel-calendar' && typeof window.maybeScrollCalendarToToday === 'function') {
            window.maybeScrollCalendarToToday();
        }

        if (targetPanelId === 'panel-overview') {
            if (typeof window.renderOverviewPanel === 'function') {
                window.renderOverviewPanel();
            }
        }
    });

});

// 學生端標籤頁切換
document.addEventListener('DOMContentLoaded', () => {
        const studentNavBtns = document.querySelectorAll('.student-nav-btn[data-panel]');    studentNavBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.dataset.panel;
            studentNavBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.student-panel').forEach((panel) => {
                panel.classList.toggle('active', panel.dataset.panelId === targetPanelId);
            });

            if (targetPanelId === 'panel-student-calendar' && typeof window.renderStudentMonthCalendar === 'function') {
                window.renderStudentMonthCalendar();
            }
            if (targetPanelId === 'panel-student-history' && typeof window.renderProgressChart === 'function') {
                window.renderProgressChart();
            }
            if (targetPanelId === 'panel-student-pay') {
                renderStudentPayPanel();
            }
        });
    });
});

window.queryMyHistory = function () {
    if (!currentUser || !currentUser.name) return;

    const startVal = document.getElementById('student-history-start').value;
    const endVal = document.getElementById('student-history-end').value;
    const resultEl = document.getElementById('student-history-result');

    if (!startVal || !endVal) {
        resultEl.innerText = '請選擇開始與結束日期';
        return;
    }
    if (startVal > endVal) {
        resultEl.innerText = '開始日期不能晚於結束日期';
        return;
    }
    if (typeof window.getStudentPeriodSummary !== 'function') {
        resultEl.innerText = '資料尚未載入完成，請稍後再試';
        return;
    }

    const floor = window.STUDENT_DATA_START || '';
    const label = window.studentDataStartLabel ? window.studentDataStartLabel() : '';

    if (floor && endVal < floor) {
        resultEl.innerText = `資料自 ${label}起算，這段期間沒有資料`;
        return;
    }

    const effectiveStart = (floor && startVal < floor) ? floor : startVal;
    const clamped = effectiveStart !== startVal;
    const noteHtml = clamped
        ? `<div class="history-start-note">資料自 ${label}起算，已從 ${floor.replace(/-/g, '/')} 開始計算</div>`
        : '';

    const s = window.getStudentPeriodSummary(currentUser.name, effectiveStart, endVal);
    if (s.scheduled.count === 0) {
        resultEl.innerHTML = `這段期間查無上課紀錄${noteHtml}`;
        return;
    }

    const fmt = (b) =>
        `<strong>${b.count}</strong> 堂（${window.formatHours(b.minutes)} 小時），$${Math.round(b.money).toLocaleString()}`;

    // 同一位學生有兩種以上課別（例如個別、團體）時，另外列出每一種各自的數字
    let breakdownHtml = '';
    const names = Object.keys(s.byName || {}).sort();
    if (names.length > 1) {
        breakdownHtml = `<div class="history-breakdown">` + names.map((n) => {
            const b = s.byName[n];
            return `
                <div class="history-breakdown-row">
                    <span class="history-breakdown-name">${payEscape(n)}</span>
                    <span>已上完 ${b.completed.count} 堂（${window.formatHours(b.completed.minutes)} 小時，$${Math.round(b.completed.money).toLocaleString()}）</span>
                    <span class="history-breakdown-sched">已預約(未上課) ${b.scheduled.count - b.completed.count} 堂（$${Math.round(b.scheduled.money - b.completed.money).toLocaleString()}）</span>
                </div>`;
        }).join('') + `</div>`;
    }

    // 已預約(未上課)＝這段期間排進行事曆、但還沒上的課
    const pending = {
        count: s.scheduled.count - s.completed.count,
        minutes: s.scheduled.minutes - s.completed.minutes,
        money: s.scheduled.money - s.completed.money
    };

    resultEl.innerHTML = `
        <div class="history-result-row"><span class="history-tag history-tag-done">已上完</span>${fmt(s.completed)}</div>
        <div class="history-result-row"><span class="history-tag history-tag-sched">已預約(未上課)</span>${fmt(pending)}</div>
        ${breakdownHtml}
        ${noteHtml}`;
};

// 學生端：只在整個學生區塊的最底下放一行起算提示（不放進任何分頁裡，避免影響各頁版面），
// 並限制日期框最早只能選到起算日
document.addEventListener('DOMContentLoaded', () => {
    const label = typeof window.studentDataStartLabel === 'function' ? window.studentDataStartLabel() : '';
    if (!label) return;

    const studentView = document.getElementById('student-view');
    if (studentView) {
        const note = document.createElement('p');
        note.className = 'data-start-note';
        note.innerText = `資料自 ${label}起算`;
        studentView.appendChild(note);
    }

    const floor = window.STUDENT_DATA_START;
    ['student-history-start', 'student-history-end'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && floor) el.min = floor;
    });
});

// 教練端：監聽所有「已收款」紀錄，給收入折線圖拆分每月已收款／待收款
let incomeRecordsUnsub = null;
window.incomePaidMap = {};

function startIncomeRecordsWatcher() {
    stopIncomeRecordsWatcher();
    incomeRecordsUnsub = onSnapshot(collection(db, 'incomeRecords'), (snap) => {
        const map = {};
        snap.forEach((d) => {
            const x = d.data();
            if (x.studentName && x.year && x.month) {
                map[`${x.year}-${x.month}-${x.studentName}`] = x.isPaid === true;
            }
        });
        window.incomePaidMap = map;

        const panel = document.getElementById('panel-income');
        if (panel && panel.classList.contains('active') && typeof window.renderIncomePanel === 'function') {
            window.renderIncomePanel();
        }
    }, (err) => console.error('監聽收款紀錄失敗:', err));
}

function stopIncomeRecordsWatcher() {
    if (incomeRecordsUnsub) { incomeRecordsUnsub(); incomeRecordsUnsub = null; }
    window.incomePaidMap = {};
}

console.log("Firebase 監聽器已啟動");

// ============================================================
// 繳費流程：學生回報匯款 → 教練確認收款
// monthIdx 一律是 JS 的 0~11
// ============================================================
let paySettings = {};
let payCoachReports = {};
let payStudentReports = {};
let payStudentIncomeMap = {};
let paySettingsError = false;   // 收款資訊讀取失敗
let payIncomeError = false;     // 收款紀錄讀取失敗
let payReportError = false;     // 匯款回報讀取失敗
let payIncomeLoaded = false;    // 收款紀錄第一次讀回來了嗎
let payReportLoaded = false;    // 匯款回報第一次讀回來了嗎
let payUnsubCoach = null;
let payUnsubStudent = [];
let payYear = new Date().getFullYear();
let payMonthIdx = new Date().getMonth();
let payCurrentAmount = 0;

function payEscape(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}
function payBaseName() {
    return window.baseStudentName(currentUser.name);
}

// 這個月是否已繳費：以基本姓名的收款紀錄為準；沒有的話看舊的、以完整名稱記錄的各課別是否全部已收款
function isStudentMonthPaid(year, monthIdx) {
    if (!currentUser || !currentUser.name || typeof window.getStudentMonthSummary !== 'function') return false;
    const names = window.getStudentMonthSummary(currentUser.name, year, monthIdx).names;
    return window.isIncomeRowPaid(year, monthIdx, payBaseName(), names, payStudentIncomeMap);
}
function payMonthKey(year, monthIdx) {
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}
function payMonthNumber(year, monthIdx) { return year * 12 + monthIdx; }
function payReportId(year, monthIdx, studentName) {
    return `${payMonthKey(year, monthIdx)}_${encodeURIComponent(studentName)}`;
}
function payReportCacheKey(year, monthIdx, studentName) {
    return `${payMonthKey(year, monthIdx)}_${studentName}`;
}
function payFormatTime(iso) {
    const t = iso ? new Date(iso) : null;
    if (!t || isNaN(t.getTime())) return '';
    return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}
window.payFormatTime = payFormatTime;

function payComputeAmount(year, monthIdx) {
    const empty = { amount: 0, minutes: 0, completedAmount: 0, pendingAmount: 0, parts: [] };
    if (!currentUser || !currentUser.name || typeof window.getStudentMonthSummary !== 'function') {
        return empty;
    }
    const s = window.getStudentMonthSummary(currentUser.name, year, monthIdx);
    const amount = Math.round(s.scheduled.money);
    const completedAmount = Math.round(s.completed.money);
    const parts = Object.entries(s.byName || {})
        .map(([name, b]) => ({ name, money: Math.round(b.scheduled.money) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        amount,
        minutes: s.scheduled.minutes,
        completedAmount,
        pendingAmount: Math.max(0, amount - completedAmount),
        parts
    };
}

async function payCopyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) { /* 忽略 */ }
        document.body.removeChild(ta);
        return ok;
    }
}

// ---------- 教練端：監聽所有回報 ----------
window.getPaymentReport = function (year, monthIdx, studentName) {
    return payCoachReports[payReportCacheKey(year, monthIdx, studentName)] || null;
};

function updateIncomeNavBadge() {
    const btn = document.querySelector('.coach-nav-btn[data-panel="panel-income"]');
    if (!btn) return;
    const pending = Object.values(payCoachReports).filter(r => r.status === 'reported').length;
    let badge = btn.querySelector('.nav-badge');
    if (pending === 0) {
        if (badge) badge.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        btn.appendChild(badge);
    }
    badge.textContent = pending;
}

function startCoachPaymentWatcher() {
    stopCoachPaymentWatcher();
    payUnsubCoach = onSnapshot(collection(db, 'paymentReports'), (snap) => {
        const cache = {};
        snap.forEach((d) => {
            const x = d.data();
            cache[payReportCacheKey(x.year, x.month - 1, x.studentName)] = x;
        });
        payCoachReports = cache;
        updateIncomeNavBadge();

        const incomePanel = document.getElementById('panel-income');
        if (incomePanel && incomePanel.classList.contains('active') &&
            typeof window.renderIncomePanel === 'function') {
            window.renderIncomePanel();
        }
    }, (err) => console.error('監聽匯款回報失敗:', err));
}

function stopCoachPaymentWatcher() {
    if (payUnsubCoach) { payUnsubCoach(); payUnsubCoach = null; }
    payCoachReports = {};
    updateIncomeNavBadge();
}

// 教練勾選／取消「已收款」時，同步回報狀態（失敗不影響收款紀錄本身）
async function syncReportStatusWithPaid(year, monthIdx, studentName, isPaid) {
    try {
        if (!payCoachReports[payReportCacheKey(year, monthIdx, studentName)]) return;
        await setDoc(doc(db, 'paymentReports', payReportId(year, monthIdx, studentName)),
            { status: isPaid ? 'confirmed' : 'reported' }, { merge: true });
    } catch (err) {
        console.error('同步回報狀態失敗:', err);
    }
}

window.cancelPaymentReport = async function (year, monthIdx, studentName) {
    if (!confirm(`確定要取消 [${studentName}] 的轉帳回報嗎？\n取消後會回到「待收款」，學生可以重新回報。`)) return;
    try {
        await deleteDoc(doc(db, 'paymentReports', payReportId(year, monthIdx, studentName)));
    } catch (err) {
        console.error('取消回報失敗:', err);
        alert('取消失敗，請稍後再試');
    }
};

// ---------- 教練端：收款資訊設定 ----------
// 取得兩組帳戶：新格式用 accounts 陣列；舊格式（只有一組）自動當成帳戶 1
function getPayAccounts(s) {
    s = s || {};
    let list;
    if (Array.isArray(s.accounts)) {
        list = s.accounts.slice(0, 2);
    } else {
        list = [{
            label: '', bankName: s.bankName || '', bankCode: s.bankCode || '',
            account: s.account || '', holder: s.holder || ''
        }];
    }
    while (list.length < 2) list.push({});
    return list.map((a) => ({
        label: a.label || '',
        bankName: a.bankName || '',
        bankCode: a.bankCode || '',
        account: a.account || '',
        holder: a.holder || ''
    }));
}

async function loadPaymentSettingsEditor() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'payment'));
        const s = snap.exists() ? snap.data() : {};
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

        getPayAccounts(s).forEach((a, i) => {
            const n = i + 1;
            setVal(`pay-set-acc${n}-label`, a.label);
            setVal(`pay-set-acc${n}-bank-name`, a.bankName);
            setVal(`pay-set-acc${n}-bank-code`, a.bankCode);
            setVal(`pay-set-acc${n}-account`, a.account);
            setVal(`pay-set-acc${n}-holder`, a.holder);
        });

        setVal('pay-set-due-day', s.dueDay);
        setVal('pay-set-linepay-note', s.linePayNote);
    } catch (err) {
        console.error('讀取收款資訊失敗:', err);
    }
}

window.savePaymentSettings = async function () {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const accounts = [1, 2].map((n) => ({
        label: val(`pay-set-acc${n}-label`),
        bankName: val(`pay-set-acc${n}-bank-name`),
        bankCode: val(`pay-set-acc${n}-bank-code`),
        account: val(`pay-set-acc${n}-account`),
        holder: val(`pay-set-acc${n}-holder`)
    }));

    // 同時把第一個有帳號的帳戶寫進舊格式欄位。
    // 如果有學生的手機還卡在舊版網頁（快取），至少還看得到一組帳戶，不會變成空白。
    const primary = accounts.find((a) => a.account) || accounts[0];

    // 每月繳費截止日：留空代表不設定
    const dueRaw = val('pay-set-due-day');
    let dueDay = null;
    if (dueRaw !== '') {
        dueDay = Number(dueRaw);
        if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
            alert('繳費截止日請填 1～28 之間的整數（留空代表不設定）');
            return;
        }
    }

    try {
        await setDoc(doc(db, 'settings', 'payment'), {
            accounts,
            dueDay,
            bankName: primary.bankName,
            bankCode: primary.bankCode,
            account: primary.account,
            holder: primary.holder,
            linePayNote: val('pay-set-linepay-note'),
            updatedAt: new Date().toISOString()
        });
        alert('✅ 收款資訊已儲存，學生端會同步更新');
    } catch (err) {
        console.error('儲存收款資訊失敗:', err);
        alert('儲存失敗，請稍後再試');
    }
};


// ---------- 學生端：監聽自己的繳費狀態、回報、收款資訊 ----------
function stopStudentPaymentWatchers() {
    payUnsubStudent.forEach((fn) => fn());
    payUnsubStudent = [];
    payStudentReports = {};
    payStudentIncomeMap = {};
    paySettingsError = payIncomeError = payReportError = false;
    payIncomeLoaded = payReportLoaded = false;
}

function startStudentPaymentWatchers(studentName) {
    stopStudentPaymentWatchers();
    if (!studentName) return;
    const base = window.baseStudentName(studentName);

    // 收款紀錄：用 studentBase 查詢，連同舊的「學生A(個別)」這種以完整名稱記錄的紀錄一起抓回來
    payUnsubStudent.push(onSnapshot(
        query(collection(db, 'incomeRecords'), where('studentBase', '==', base)),
        (snap) => {
            const map = {};
            snap.forEach((d) => {
                const x = d.data();
                if (!window.belongsToStudent(x.studentName, base)) return;
                map[`${x.year}-${x.month}-${x.studentName}`] = x.isPaid === true;
            });
            payStudentIncomeMap = map;
            payIncomeError = false;
            payIncomeLoaded = true;
            refreshStudentPaymentViews();
        },
        (err) => { console.error('監聽繳費狀態失敗:', err); payIncomeError = true; refreshStudentPaymentViews(); }
    ));

    payUnsubStudent.push(onSnapshot(
        query(collection(db, 'paymentReports'), where('studentName', '==', base)),
        (snap) => {
            const reports = {};
            snap.forEach((d) => {
                const x = d.data();
                reports[payMonthKey(x.year, x.month - 1)] = x;
            });
            payStudentReports = reports;
            payReportError = false;
            payReportLoaded = true;
            refreshStudentPaymentViews();
        },
        (err) => { console.error('監聽匯款回報失敗:', err); payReportError = true; refreshStudentPaymentViews(); }
    ));

    payUnsubStudent.push(onSnapshot(
        doc(db, 'settings', 'payment'),
        (snap) => {
            paySettings = snap.exists() ? snap.data() : {};
            paySettingsError = false;
            refreshStudentPaymentViews();
        },
        (err) => { console.error('監聽收款資訊失敗:', err); paySettingsError = true; refreshStudentPaymentViews(); }
    ));
}

function refreshStudentPaymentViews() {
    if (!currentUser || currentUser.role !== 'student') return;
    updateHomePaymentCard();
    renderDueReminder();
    const payPanel = document.getElementById('panel-student-pay');
    if (payPanel && payPanel.classList.contains('active')) renderStudentPayPanel();
}

// ------------------------------------------------------------
// 費用提醒：上個月（或更早）還沒繳的費用，在首頁最上方提醒；教練可設定每月繳費截止日。
// 第 M 月的費用，截止日是「下個月的 dueDay 號」（例如截止日設 5：11 月的費用要在 12/5 前繳）。
// ------------------------------------------------------------
function payDueInfo(year, monthIdx) {
    const dueDay = Number(paySettings && paySettings.dueDay);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return null;   // 教練沒設截止日
    const now = new Date();
    if (payMonthNumber(year, monthIdx) >= payMonthNumber(now.getFullYear(), now.getMonth())) return null;   // 本月的費用還沒到截止
    const dueDate = new Date(year, monthIdx + 1, dueDay);
    const label = `${dueDate.getMonth() + 1}/${dueDate.getDate()}`;
    const overdue = toYMD(now) > toYMD(dueDate);   // 截止日當天還算準時，隔天才算逾期
    return { dueDate, label, overdue, text: overdue ? `已逾期（應於 ${label} 前繳費）` : `請於 ${label} 前繳費` };
}

// 找出「本月以前、有費用、還沒繳清」的月份（由舊到新）
function getUnpaidPastMonths() {
    const now = new Date();
    const curNum = payMonthNumber(now.getFullYear(), now.getMonth());
    const result = [];
    for (let num = payEarliestMonthNumber(); num < curNum; num++) {
        const year = Math.floor(num / 12);
        const monthIdx = num % 12;
        const { amount } = payComputeAmount(year, monthIdx);
        if (amount <= 0) continue;
        if (isStudentMonthPaid(year, monthIdx)) continue;
        const report = payStudentReports[payMonthKey(year, monthIdx)];
        result.push({ year, monthIdx, amount, reported: !!report && report.status === 'reported', due: payDueInfo(year, monthIdx) });
    }
    return result;
}

// 點「前往繳費」：切到繳費分頁，並停在那個月
function goToPayMonth(year, monthIdx) {
    payYear = year;
    payMonthIdx = monthIdx;
    const tab = document.querySelector('.student-nav-btn[data-panel="panel-student-pay"]');
    if (tab) tab.click();   // 分頁切換時會自動畫出 payYear / payMonthIdx 這個月
}

function renderDueReminder() {
    const old = document.getElementById('student-due-card');
    if (old) old.remove();
    if (!currentUser || currentUser.role !== 'student' || !currentUser.name) return;
    // 資料還沒讀完、或讀取失敗時不顯示，免得把「還在讀」誤報成「沒繳費」
    if (!Array.isArray(window.courses) || !payIncomeLoaded || !payReportLoaded || payIncomeError || payReportError) return;

    const items = getUnpaidPastMonths();
    if (items.length === 0) return;
    const host = document.querySelector('#panel-student-home .panel-inner') || document.getElementById('panel-student-home');
    if (!host) return;

    const needAction = items.filter((it) => !it.reported);
    const overdue = needAction.some((it) => it.due && it.due.overdue);

    const card = document.createElement('div');
    card.id = 'student-due-card';
    card.className = `student-due-card ${needAction.length === 0 ? 'is-info' : overdue ? 'is-overdue' : 'is-warn'}`;

    const title = document.createElement('div');
    title.className = 'student-due-title';
    title.innerText = needAction.length === 0 ? '📌 費用確認中' : overdue ? '⚠️ 有費用已逾期' : '⚠️ 還有費用沒繳';
    card.appendChild(title);

    items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'student-due-row';

        const info = document.createElement('span');
        info.className = 'student-due-info';
        const state = it.reported ? '已回報，等待教練確認' : (it.due ? it.due.text : '尚未繳費');
        info.innerText = `${it.monthIdx + 1} 月　$${it.amount.toLocaleString()}　${state}`;
        row.appendChild(info);

        if (!it.reported) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerText = '前往繳費';
            btn.addEventListener('click', () => goToPayMonth(it.year, it.monthIdx));
            row.appendChild(btn);
        }
        card.appendChild(row);
    });

    const banner = document.getElementById('student-banner');
    host.insertBefore(card, banner ? banner.nextSibling : host.firstChild);
}

function updateHomePaymentCard() {
    const now = new Date();
    const year = now.getFullYear();
    const monthIdx = now.getMonth();
    const key = payMonthKey(year, monthIdx);

    const amountEl = document.getElementById('student-class-count');
    const coursesReady = Array.isArray(window.courses);
    const { amount, completedAmount } = payComputeAmount(year, monthIdx);

    // 費用卡只顯示「本月累積費用（已上完）」＝這個月已經上完的課的費用
    if (amountEl) {
        amountEl.innerText = coursesReady ? `$${completedAmount.toLocaleString()}` : '—';
        amountEl.style.color = '';
    }

    const statusEl = document.getElementById('student-payment-status');
    if (!statusEl) return;
    const set = (text, color) => { statusEl.innerText = text; statusEl.style.color = color; };
    const report = payStudentReports[key];

    if (!coursesReady) { set('讀取中…', '#90a4ae'); return; }
    if (payIncomeError || payReportError) { set('無法讀取', '#90a4ae'); return; }   // 讀不到就誠實說讀不到，不要顯示成「未繳費」
    if (isStudentMonthPaid(year, monthIdx)) { set('已繳費', '#2e7d32'); return; }
    if (report && report.status === 'reported') { set('已回報，待確認', '#e67e22'); return; }
    if (coursesReady && amount <= 0) { set('本月無費用', '#7f8c8d'); return; }
    set('未繳費', '#d32f2f');
}

// 繳費頁最早能切到的月份：學生端資料起算月（2026 年 10 月）。
// 不管這位學生哪個月開始上課，都可以自己往前翻；最晚只到本月（教練的財務報表也只看到本月）。
function payEarliestMonthNumber() {
    const now = new Date();
    const curNum = payMonthNumber(now.getFullYear(), now.getMonth());
    const startStr = window.STUDENT_DATA_START;
    if (startStr) {
        const startNum = payMonthNumber(
            parseInt(startStr.slice(0, 4), 10),
            parseInt(startStr.slice(5, 7), 10) - 1
        );
        return Math.min(startNum, curNum);
    }
    // 沒有設定起算點時，退回「第一堂課的月份」
    let min = curNum;
    (window.courses || []).forEach((c) => {
        if (!c || c.type !== 'work' || !c.date) return;
        const y = parseInt(c.date.slice(0, 4), 10);
        const m = parseInt(c.date.slice(5, 7), 10) - 1;
        if (Number.isFinite(y) && Number.isFinite(m)) min = Math.min(min, payMonthNumber(y, m));
    });
    return min;
}

window.changePayMonth = function (direction) {
    const now = new Date();
    const maxNum = payMonthNumber(now.getFullYear(), now.getMonth());
    const minNum = Math.min(payEarliestMonthNumber(), maxNum);
    const next = Math.max(minNum, Math.min(maxNum, payMonthNumber(payYear, payMonthIdx) + direction));
    payYear = Math.floor(next / 12);
    payMonthIdx = next % 12;
    renderStudentPayPanel();
};

function setPayBanner(type, html) {
    let el = document.getElementById('pay-status-banner');
    if (!el) {
        // index.html 沒有這個容器時自動建立，放在「應繳金額」下面
        const anchor = document.getElementById('pay-breakdown');
        if (!anchor) return;
        el = document.createElement('div');
        el.id = 'pay-status-banner';
        anchor.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = `<div class="pay-banner pay-banner-${type}">${html}</div>`;
}

function renderPayMethodHtml() {
    const s = paySettings || {};
    // 帳號欄位有填的才顯示；idx 記住它原本是第幾組，複製按鈕才不會複製錯帳戶
    const accounts = getPayAccounts(s)
        .map((a, i) => ({ ...a, idx: i }))
        .filter((a) => a.account);
    const linePayNote = String(s.linePayNote || '').trim();

    // 收款資訊讀不到、而且沒有任何內容可以顯示時，才顯示讀取失敗
    if (paySettingsError && accounts.length === 0 && !linePayNote) {
        return `<div class="pay-card"><p class="no-data-hint">收款資訊暫時無法讀取，請稍後再試，或直接聯繫教練。</p></div>`;
    }

    // LINE Pay 一定顯示一行；教練有補充說明就顯示在下面
    let html = `
        <div class="pay-card pay-methods">
            <h3 class="pay-section-title">付款方式</h3>
            <div class="pay-method-row">
                <div class="pay-method-name">📱 LINE Pay 好友轉帳</div>
                ${linePayNote ? `<p class="pay-note">${payEscape(linePayNote)}</p>` : ''}
            </div>`;

    if (accounts.length > 0) {
        html += `
            <div class="pay-method-row">
                <div class="pay-method-name">🏦 銀行轉帳</div>
                ${accounts.map((a) => {
                    const name = [a.label, a.bankName].filter(Boolean).join('｜');
                    const head = `${payEscape(name)}${a.bankCode ? `（代碼 ${payEscape(a.bankCode)}）` : ''}`;
                    return `
                <div class="pay-bank">
                    ${head ? `<div class="pay-bank-head">${head}</div>` : ''}
                    <div class="pay-bank-account">
                        <span class="pay-bank-number">${payEscape(a.account)}</span>
                        <button type="button" class="pay-copy-btn" onclick="copyPayAccount(${a.idx}, this)">複製帳號</button>
                    </div>
                    ${a.holder ? `<div class="pay-bank-holder">戶名 ${payEscape(a.holder)}</div>` : ''}
                </div>`;
                }).join('')}
            </div>`;
    }

    return html + `
        </div>`;
}

// 複製某一個銀行帳戶的帳號（idx＝設定裡的第幾組帳戶）
window.copyPayAccount = async function (idx, btn) {
    const a = getPayAccounts(paySettings)[idx] || {};
    const ok = await payCopyToClipboard(a.account || '');
    if (!ok) { alert('複製失敗，請手動長按文字複製'); return; }
    if (btn) {
        const original = btn.innerText;
        btn.innerText = '已複製 ✓';
        setTimeout(() => { btn.innerText = original; }, 1500);
    }
};

function renderStudentPayPanel() {
    if (!currentUser || currentUser.role !== 'student' || !currentUser.name) return;
    if (studentPendingReason) {
        setPayBanner('none', '你的帳號還在等待教練核准，核准後才能查看繳費資訊。');
        const m = document.getElementById('pay-method-area'); if (m) m.innerHTML = '';
        const r = document.getElementById('pay-report-area'); if (r) r.innerHTML = '';
        return;
    }

    const now = new Date();
    const maxNum = payMonthNumber(now.getFullYear(), now.getMonth());
    const minNum = Math.min(payEarliestMonthNumber(), maxNum);
    const curNum = Math.max(minNum, Math.min(maxNum, payMonthNumber(payYear, payMonthIdx)));
    payYear = Math.floor(curNum / 12);
    payMonthIdx = curNum % 12;

    const labelEl = document.getElementById('pay-month-label');
    if (labelEl) labelEl.innerText = `${payYear} 年 ${payMonthIdx + 1} 月`;
    const prevBtn = document.getElementById('pay-month-prev');
    const nextBtn = document.getElementById('pay-month-next');
    if (prevBtn) prevBtn.disabled = curNum <= minNum;
    if (nextBtn) nextBtn.disabled = curNum >= maxNum;

    const { amount, minutes, completedAmount, pendingAmount, parts } = payComputeAmount(payYear, payMonthIdx);
    payCurrentAmount = amount;

    const amountEl = document.getElementById('pay-amount');
    const hoursEl = document.getElementById('pay-hours');
    const breakdownEl = document.getElementById('pay-breakdown');
    if (amountEl) amountEl.innerText = `$${amount.toLocaleString()}`;
    if (hoursEl) hoursEl.innerText = `共 ${Number((minutes / 60).toFixed(2))} 小時`;
    if (breakdownEl) {
        if (amount <= 0) {
            breakdownEl.innerHTML = '';
        } else {
            const partsLine = parts.length > 1
                ? `<span class="pay-breakdown-line">${parts.map(p => `${payEscape(p.name)} $${p.money.toLocaleString()}`).join('　＋　')}</span>`
                : '';
            const statusLine = pendingAmount > 0
                ? `其中已上完 $${completedAmount.toLocaleString()}、已預約(未上課) $${pendingAmount.toLocaleString()}`
                : '這個月的課程全部已上完';
            breakdownEl.innerHTML = `${partsLine}<span class="pay-breakdown-line">${statusLine}</span>`;
        }
    }

    const methodEl = document.getElementById('pay-method-area');
    const reportEl = document.getElementById('pay-report-area');
    const key = payMonthKey(payYear, payMonthIdx);
    const paid = isStudentMonthPaid(payYear, payMonthIdx);
    const report = payStudentReports[key] || null;

    if (amount <= 0) {
        setPayBanner('none', '這個月沒有需要繳費的課程');
        if (methodEl) methodEl.innerHTML = '';
        if (reportEl) reportEl.innerHTML = '';
        return;
    }
    if (payIncomeError || payReportError) {
        setPayBanner('none', '繳費狀態暫時無法讀取，請稍後再試。');
        if (methodEl) methodEl.innerHTML = renderPayMethodHtml();
        if (reportEl) reportEl.innerHTML = '';
        return;
    }
    if (paid) {
        setPayBanner('paid', '✅ 已繳費<br><small>教練已確認收款，謝謝！</small>');
        if (methodEl) methodEl.innerHTML = '';
        if (reportEl) reportEl.innerHTML = '';
        return;
    }

    if (methodEl) methodEl.innerHTML = renderPayMethodHtml();

    if (report && report.status === 'reported') {
        setPayBanner('reported',
            `⏳ 已回報，等待教練確認<br><small>${report.method === 'linepay' ? 'LINE Pay' : (report.last5 ? `後五碼 ${payEscape(report.last5)}` : '銀行轉帳')}｜${payEscape(payFormatTime(report.reportedAt))}</small>`);
        if (reportEl) reportEl.innerHTML =
            `<button type="button" class="pay-report-btn" disabled>已回報，等待教練確認</button>`;
    } else {
        const due = payDueInfo(payYear, payMonthIdx);
        setPayBanner('unpaid', due ? `尚未繳費<br><small>${due.text}</small>` : '尚未繳費');
        if (reportEl) reportEl.innerHTML =
            `<button type="button" class="pay-report-btn" onclick="openReportModal()">已付款，回報繳費狀況</button>`;
    }
}

// ---------- 學生端：回報視窗 ----------
window.openReportModal = function () {
    if (payCurrentAmount <= 0) return;
    document.getElementById('report-modal-summary').innerText =
        `${payYear} 年 ${payMonthIdx + 1} 月　應繳 $${payCurrentAmount.toLocaleString()}`;

    // 預設的付款方式：教練沒設銀行帳號時，預設選 LINE Pay
    const hasBank = getPayAccounts(paySettings).some((a) => a.account);
    const methodEl = document.getElementById('report-method');
    if (methodEl) methodEl.value = hasBank ? 'bank' : 'linepay';

    const input = document.getElementById('report-last5');
    input.value = '';
    document.getElementById('report-error').textContent = '';
    document.getElementById('report-form-state').classList.remove('hide');
    document.getElementById('report-done-state').classList.add('hide');
    document.getElementById('report-modal').classList.remove('hide');
    onReportMethodChange();
    if (!methodEl || methodEl.value === 'bank') input.focus();
};

// 選 LINE Pay 時不需要填後五碼，把那一欄收起來
window.onReportMethodChange = function () {
    const methodEl = document.getElementById('report-method');
    const wrap = document.getElementById('report-last5-wrap');
    const errEl = document.getElementById('report-error');
    if (wrap) wrap.classList.toggle('hide', !!methodEl && methodEl.value === 'linepay');
    if (errEl) errEl.textContent = '';
};

window.closeReportModal = function () {
    document.getElementById('report-modal').classList.add('hide');
};

window.submitPaymentReport = async function () {
    const methodEl = document.getElementById('report-method');
    const method = methodEl && methodEl.value === 'linepay' ? 'linepay' : 'bank';
    const errEl = document.getElementById('report-error');
    const submitBtn = document.getElementById('report-submit-btn');
    errEl.textContent = '';

    // 只有銀行轉帳需要後五碼；LINE Pay 在你的 LINE Pay 紀錄裡就看得到轉帳人與金額
    let last5 = '';
    if (method === 'bank') {
        last5 = document.getElementById('report-last5').value.trim();
        if (!/^\d{5}$/.test(last5)) {
            errEl.textContent = '請輸入 5 位數字的匯款帳號後五碼';
            return;
        }
    }
    if (!currentUser || !currentUser.name || payCurrentAmount <= 0) return;

    submitBtn.disabled = true;
    try {
        await setDoc(doc(db, 'paymentReports', payReportId(payYear, payMonthIdx, payBaseName())), {
            studentName: payBaseName(),
            year: payYear,
            month: payMonthIdx + 1,
            amount: payCurrentAmount,
            method,
            last5,
            status: 'reported',
            reportedAt: new Date().toISOString()
        });
        document.getElementById('report-form-state').classList.add('hide');
        document.getElementById('report-done-state').classList.remove('hide');
    } catch (err) {
        console.error('送出回報失敗:', err);
        errEl.textContent = (err && err.code === 'permission-denied')
            ? '送出失敗：沒有權限。請聯絡教練確認你的帳號資料。'
            : (navigator.onLine === false ? '目前沒有網路，請連線後再送出。' : '送出失敗，請稍後再試。');
    } finally {
        submitBtn.disabled = false;
    }
};