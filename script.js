// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBPakjvgH-8ungDxefsJH6x7AuAo6qRFBc",
  authDomain: "attendiq-6f046.firebaseapp.com",
  projectId: "attendiq-6f046",
  storageBucket: "attendiq-6f046.firebasestorage.app",
  messagingSenderId: "1043535678423",
  appId: "1:1043535678423:web:70977ee9e7c0c95ddc1992",
  measurementId: "G-DJ9LKYSJG6"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();


let subjects = [];
let timetable = [];
let overallTrend = [];
let currentUser = null;
let minAttendanceValue = 75;
let lastMessageTimeout = null;
let extractedTimetable = [];
let reminderTimers = [];
let currentPromptSubject = null;

function isNonAcademicSubject(name) {
    if (!name) return false;
    const n = String(name).toLowerCase();
    const norm = normalizeAlpha(n); // letters only
    return norm.includes("library") || norm.includes("sports") || norm === "sport" || norm.includes("break") || norm.includes("lunch") || /15\s*min/.test(n);
}

function normalizeAlpha(s){ return (s||"").toLowerCase().replace(/[^a-z]/g,""); }

function fuzzyDayName(s) {
    const v = normalizeAlpha(s);
    const dayVars = {
        Monday: ["monday","mon","mondy"],
        Tuesday: ["tuesday","tues","tue","tuseday","tuesdy","tueday","teusday","tusday"],
        Wednesday: ["wednesday","wed","wensday","wednsday"],
        Thursday: ["thursday","thur","thurs","thurday","thusday","thrsday","thrsdy","thursdayy"],
        Friday: ["friday","fri","frlday","fridav","fridoy"],
        Saturday: ["saturday","sat","saterday"],
        Sunday: ["sunday","sun"]
    };
    for (const [canon, variants] of Object.entries(dayVars)) {
        for (const vv of variants) {
            if (v.includes(vv)) return canon;
        }
        if (v.startsWith(canon.slice(0,3).toLowerCase())) return canon;
    }
    let best = null, bestScore = 9;
    const days = Object.keys(dayVars);
    for (const d of days) {
        const score = lev(v.slice(0, d.length), d.toLowerCase());
        if (score < bestScore) { bestScore = score; best = d; }
    }
    if (bestScore <= 2) return best;
    return null;
}

function timeToMinutes(hhmm) {
    const [h,m] = String(hhmm||"0:0").split(":").map(x=>parseInt(x,10)||0);
    return h*60 + m;
}

function isLunchTimeslot(start, end) {
    return timeToMinutes(start) === 12*60+45 && timeToMinutes(end) === 14*60;
}

function isLunchLikeLabel(label) {
    const v = normalizeAlpha(label);
    return v.includes("lunch") || v.includes("break") || /^l{1,3}$/.test(v) || /^lun?$/.test(v) || v === "lb" || v === "lnch";
}

function isLunchCell(label, start, end) {
    return isLunchLikeLabel(label) || isLunchTimeslot(start, end);
}
function isBreakTimeslot(start, end) {
    return timeToMinutes(start) === 11*60+30 && timeToMinutes(end) === 11*60+45;
}
function isBreakLikeLabel(label) {
    const v = normalizeAlpha(label);
    return v.includes("break") || v === "brk" || v === "bk" || v === "b";
}
function isBreakCell(label, start, end) {
    return isBreakLikeLabel(label) || isBreakTimeslot(start, end);
}

function lev(a,b){
    const m=a.length, n=b.length;
    const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
        for(let j=1;j<=n;j++){
            const cost = a[i-1]===b[j-1]?0:1;
            dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
        }
    }
    return dp[m][n];
}
// ================= AUTH =================

function signUp() {
    let email = document.getElementById("email").value;
    let password = document.getElementById("password").value;

    auth.createUserWithEmailAndPassword(email, password)
        .then(() => showMessage("success", "Account created"))
        .catch(error => showMessage("error", error.message));
}

function signIn() {
    let email = document.getElementById("email").value;
    let password = document.getElementById("password").value;

    auth.signInWithEmailAndPassword(email, password)
        .then(() => showMessage("success", "Signed in"))
        .catch(error => showMessage("error", error.message));
}

function googleSignIn() {
    let provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(() => {
        showMessage("success", "Signed in with Google");
    }).catch(err => {
        if (err && err.code === "auth/popup-blocked") {
            showMessage("info", "Popup blocked, redirecting to Google sign-in…");
            auth.signInWithRedirect(provider);
        } else {
            showMessage("error", err.message || "Google sign-in failed");
        }
    });
}

function logout() {
    auth.signOut().then(() => showMessage("info", "Signed out"));
}

auth.onAuthStateChanged(user => {

    if (user) {
        currentUser = user;
        loadCloudData();
    } else {
        currentUser = null;
        subjects = [];
        timetable = [];
        overallTrend = [];
        renderSubjects();
        renderTimetable();
    }

    setAuthUIState();
    setStatus();
});

// ================= SUBJECTS =================

function addSubject() {

    if (!currentUser) {
        alert("Please login first.");
        return;
    }

    let name = document.getElementById("subjectName").value;
    let attended = parseInt(document.getElementById("attended").value);
    let total = parseInt(document.getElementById("total").value);

    if (!name || isNaN(attended) || isNaN(total) || total === 0) {
        alert("Invalid input.");
        return;
    }

    const pct = (attended / total) * 100;
    subjects.push({ name, attended, total, trend: [pct] });
    saveCloudData();
    renderSubjects();
}

function markPresent(index) {
    subjects[index].attended++;
    subjects[index].total++;
    pushSubjectTrend(index);
    pushOverallTrend();
    saveCloudData();
    renderSubjects();
}

function markAbsent(index) {
    subjects[index].total++;
    pushSubjectTrend(index);
    pushOverallTrend();
    saveCloudData();
    renderSubjects();
}

function deleteSubject(index) {
    const ok = confirm("Delete this subject?");
    if (!ok) return;
    subjects.splice(index, 1);
    pushOverallTrend();
    saveCloudData();
    renderSubjects();
}

// ================= TIMETABLE =================

function addTimetable() {

    if (!currentUser) {
        alert("Please login first.");
        return;
    }

    let subject = document.getElementById("ttSubject").value;
    let day = document.getElementById("ttDay").value;
    let startTime = document.getElementById("ttStartTime").value;
    let endTime = document.getElementById("ttEndTime").value;

    if (!subject || !day || !startTime || !endTime) {
        alert("Invalid timetable input.");
        return;
    }

    if (isNonAcademicSubject(subject)) {
        showMessage("info", "Skipped non-academic slot");
        return;
    }

    if (/lab/i.test(subject)) {
        endTime = addHoursToTime(startTime, 3);
    }

    timetable.push({ subject, day, startTime, endTime });
    ensureSubjectExists(subject);
    saveCloudData();
    renderSubjects();
    renderTimetable();
    scheduleReminders();
}

// ================= RENDER =================

function renderSubjects() {

    let container = document.getElementById("subjectsContainer");
    container.innerHTML = "";

    if (subjects.length === 0) return;

    let totalAttended = 0;
    let totalClasses = 0;
    let minRequired = parseFloat(document.getElementById("minAttendance").value) || minAttendanceValue;
    minAttendanceValue = minRequired;

    subjects.forEach((sub, index) => {

        if (!sub.trend) sub.trend = [];
        let percentage = (sub.attended / sub.total) * 100;
        totalAttended += sub.attended;
        totalClasses += sub.total;

        let status = "";
        let badge = "";
        let cardExtra = "";

        if (percentage >= minRequired + 5) {
            status = "Safe";
            badge = "safe-badge";
        } else if (percentage >= minRequired) {
            status = "Warning";
            badge = "warning-badge";
        } else {
            status = "Critical";
            badge = "critical-badge";
            cardExtra = "critical-blink shake";
        }

        const trendBars = buildTrendBars(sub.trend, minRequired);

        container.innerHTML += `
            <div class="card ${cardExtra}">
                <h3>${sub.name}</h3>
                <div class="progress"><div class="progress-bar" style="width:${Math.min(100, Math.max(0, percentage))}%"></div></div>
                <p>${percentage.toFixed(1)}%</p>
                <p class="status-badge ${badge}">${status}</p>
                <div class="trend">${trendBars}</div>
                <button onclick="markPresent(${index})">Present</button>
                <button onclick="markAbsent(${index})">Absent</button>
                <button onclick="deleteSubject(${index})">Delete</button>
            </div>
        `;
    });

    let overall = (totalAttended / totalClasses) * 100;

    container.innerHTML =
        `
        <div class="card">
            <h2>Overall Attendance</h2>
            <div class="progress"><div class="progress-bar" style="width:${Math.min(100, Math.max(0, overall))}%"></div></div>
            <p>${overall.toFixed(1)}%</p>
            <div class="trend">${buildTrendBars(overallTrend, minRequired)}</div>
        </div>
        ` + container.innerHTML;

    renderTimetable();
}

function renderTimetable() {
    const daysOrder = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const cont = document.getElementById("timetableContainer");
    if (!cont) return;
    if (!timetable) timetable = [];
    const before = timetable.length;
    timetable = timetable.filter(i => !isNonAcademicSubject(i.subject));
    if (timetable.length !== before) {
        saveCloudData();
    }
    const items = [...timetable].sort((a,b) => {
        const da = daysOrder.indexOf(a.day);
        const db = daysOrder.indexOf(b.day);
        if (da !== db) return da - db;
        return (a.startTime||"").localeCompare(b.startTime||"");
    });
    const html = items.map(i => `
        <div class="tt-item">
            <h4>${i.day}</h4>
            <div><strong>${i.subject}</strong></div>
            <div>${i.startTime} - ${i.endTime}</div>
        </div>
    `).join("");
    cont.innerHTML = `
        <div class="card">
            <h2>Weekly Timetable</h2>
            <div class="tt-list">${html || "<em>No entries yet</em>"}</div>
        </div>
    `;
    scheduleReminders();
}

function buildTrendBars(values, minRequired) {
    const v = (values || []).slice(-7);
    return v.map(p => {
        const cl = p >= (minRequired+5) ? "bar-safe" : (p >= minRequired ? "bar-warning" : "bar-critical");
        const h = Math.max(6, Math.min(100, Math.round(p)));
        return `<span class="trend-bar ${cl}" style="height:${h}%"></span>`;
    }).join("");
}

function pushSubjectTrend(index) {
    const sub = subjects[index];
    if (!sub) return;
    if (!sub.trend) sub.trend = [];
    const pct = (sub.attended / sub.total) * 100;
    sub.trend.push(pct);
    if (sub.trend.length > 7) sub.trend = sub.trend.slice(-7);
}

function pushOverallTrend() {
    const totals = subjects.reduce((acc, s) => {
        acc.att += s.attended; acc.cls += s.total; return acc;
    }, {att:0, cls:0});
    if (totals.cls === 0) return;
    const pct = (totals.att / totals.cls) * 100;
    overallTrend.push(pct);
    if (overallTrend.length > 7) overallTrend = overallTrend.slice(-7);
}

// ================= CLOUD =================

function saveCloudData() {

    if (!currentUser) return;

    const minEl = document.getElementById("minAttendance");
    const min = parseFloat(minEl && minEl.value) || minAttendanceValue || 75;
    db.collection("users").doc(currentUser.uid).set({
        subjects: subjects,
        timetable: timetable,
        overallTrend: overallTrend,
        minAttendance: min
    }).then(() => {
        showMessage("success", "Saved to cloud");
    }).catch(e => showMessage("error", e.message));
}

function loadCloudData() {

    db.collection("users").doc(currentUser.uid).get()
        .then(doc => {

            if (doc.exists) {
                subjects = (doc.data().subjects || []).map(s => {
                    if (!s.trend) {
                        const pct = (s.total > 0) ? (s.attended / s.total) * 100 : 0;
                        s.trend = [pct];
                    } else {
                        s.trend = s.trend.slice(-7);
                    }
                    return s;
                });
                timetable = doc.data().timetable || [];
                overallTrend = (doc.data().overallTrend || []).slice(-7);
                minAttendanceValue = doc.data().minAttendance || 75;
                const minEl = document.getElementById("minAttendance");
                if (minEl) minEl.value = String(minAttendanceValue);
                showMessage("info", "Cloud data loaded");
            }

            renderSubjects();
            renderTimetable();
        })
        .catch(e => showMessage("error", e.message));
}

// expose functions for inline handlers (module scope doesn't attach to window by default)
window.signUp = signUp;
window.signIn = signIn;
window.googleSignIn = googleSignIn;
window.logout = logout;
window.addSubject = addSubject;
window.markPresent = markPresent;
window.markAbsent = markAbsent;
window.deleteSubject = deleteSubject;
window.addTimetable = addTimetable;
window.resetData = resetData;
window.toggleTheme = toggleTheme;
window.extractTimetableFromImage = extractTimetableFromImage;
window.saveExtractedTimetable = saveExtractedTimetable;

function setAuthUIState() {
    const disabled = !currentUser;
    const ids = ["subjectName","attended","total","addSubjectBtn","ttSubject","ttDay","ttStartTime","ttEndTime","addTimetableBtn","minAttendance","resetBtn"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    });
}

function setStatus() {
    const el = document.getElementById("status");
    if (!el) return;
    if (currentUser) {
      el.textContent = `Signed in as ${currentUser.email || "user"}`;
    } else {
      el.textContent = "Please sign in to use cloud features";
    }
}

function resetData() {
    if (!currentUser) return;
    const ok = confirm("Reset all your cloud data?");
    if (!ok) return;
    subjects = [];
    timetable = [];
    overallTrend = [];
    saveCloudData();
    renderSubjects();
    renderTimetable();
}

function toggleTheme() {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("theme", isDark ? "dark" : "light");
}

const savedTheme = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
}

function navTo(name) {
    const screens = ["dashboard","timetable","settings"];
    screens.forEach(s => {
        const el = document.getElementById(`screen-${s}`);
        if (el) el.classList.toggle("hidden", s !== name);
    });
    const tabs = document.getElementsByClassName("tab");
    Array.from(tabs).forEach(b => b.classList.remove("active"));
    const index = screens.indexOf(name);
    if (index >= 0 && tabs[index]) tabs[index].classList.add("active");
    location.hash = name;
}

window.navTo = navTo;
setTimeout(() => {
    const initial = (location.hash || "#dashboard").replace("#","");
    navTo(initial);
}, 0);

async function extractTimetableFromImage() {
    const fileInput = document.getElementById("ocrImage");
    const progress = document.getElementById("ocrProgress");
    const saveBtn = document.getElementById("ocrSaveBtn");
    const preview = document.getElementById("ocrPreview");
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showMessage("error", "Choose an image with your timetable");
        return;
    }
    const file = fileInput.files[0];
    if (!window.Tesseract) {
        showMessage("error", "OCR engine not loaded");
        return;
    }
    saveBtn.disabled = true;
    preview.innerHTML = "";
    progress.textContent = "Reading image…";
    try {
        const imgSource = await preprocessImage(file); // canvas or blob
        const worker = await Tesseract.createWorker();
        await worker.setParameters({
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:&- .',
        });
        await worker.loadLanguage("eng");
        await worker.initialize("eng");
        const { data } = await worker.recognize(imgSource);
        await worker.terminate();
        const raw = data.text || "";
        progress.textContent = "Parsing text…";
        const items = parseOCRText(raw);
        extractedTimetable = items;
        renderOCRPreview(items);
        saveBtn.disabled = items.length === 0;
        const previewSnippet = raw.split(/\r?\n/).slice(0,8).join(" · ");
        progress.textContent = items.length ? `Found ${items.length} entries` : `No entries detected. OCR sample: ${previewSnippet}`;
    } catch (e) {
        showMessage("error", e.message || "OCR failed");
        progress.textContent = "";
    }
}

function parseOCRText(text) {
    const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const lines = text.split(/\r?\n/).map(s=>s.replace(/\t+/g," ").trim()).filter(Boolean);
    const timeRe = /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)[\s]*?(?:to|[-–]|TO)\s*?(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/ig;
    let headerTimes = [];
    for (let i=0;i<Math.min(30,lines.length);i++){
        let l = lines[i];
        l = l.replace(/O/g,'0').replace(/\bI\b/g,'1').replace(/l/g,'1');
        let m;
        while ((m = timeRe.exec(l)) !== null) {
            headerTimes.push({start: normalizeTime(m[1]), end: normalizeTime(m[2])});
        }
        if (headerTimes.length>=2) break;
    }
    if (headerTimes.length < 2) {
        headerTimes = [
            {start:"09:30", end:"10:30"},
            {start:"10:30", end:"11:30"},
            {start:"11:45", end:"12:45"},
            {start:"12:45", end:"14:00"},
            {start:"14:00", end:"15:00"},
            {start:"15:00", end:"16:00"},
            {start:"16:00", end:"17:00"}
        ];
    }
    if (headerTimes.length>=2){
        const out = [];
        // Build day blocks using fuzzy day detection
        const dayIdxs = [];
        for (let k=0;k<lines.length;k++){
            const d = fuzzyDayName(lines[k]);
            if (d) dayIdxs.push(k);
        }
        dayIdxs.forEach((idx, i) => {
            const next = i+1 < dayIdxs.length ? dayIdxs[i+1] : lines.length;
            const head = lines[idx];
            const day = fuzzyDayName(head) || days.find(d=>new RegExp(`\\b${d}\\b`,'i').test(head));
            const block = lines.slice(idx, next).map(s=>s.replace(/O/g,'0'));
            // Remove the day label (rough)
            if (block.length) {
                const b0 = block[0];
                const dname = day ? day.toLowerCase() : "";
                if (dname && b0.toLowerCase().includes(dname)) {
                    block[0] = b0.replace(new RegExp(dname,"i"), "").trim();
                }
            }
            // Join block lines into one row string and split into cells
            const rowJoined = block
              .filter(ln => {
                  const simple = normalizeAlpha(ln);
                  if (!simple) return false;
                  if (simple.includes('break')) return false;
                  if (simple.includes('lunch')) return false;
                  if (/^\d+(\.\d+)?min/i.test(ln)) return false;
                  return true;
              })
              .join(' ')
              .replace(/l\s*u\s*n\s*c\s*h(\s*b\s*r\s*e\s*a\s*k)?/ig, ' | ')
              .replace(/b\s*r\s*e\s*a\s*k/ig, ' | ')
              .replace(/\s{3,}/g,' | ')
              .replace(/\s{2,}/g,' | ')
              .replace(/\s*\|\s*/g,'|');
            const cells = rowJoined.split('|').map(s=>s.trim()).filter(Boolean);
            let ci = 0;
            while (ci < cells.length && ci < headerTimes.length) {
                const subj = cells[ci].replace(/[^\w\s\-&]/g," ").replace(/\s{2,}/g," ").trim();
                if (!subj || isNonAcademicSubject(subj)) { ci++; continue; }
                if (isLunchCell(subj, headerTimes[ci].start, headerTimes[ci].end)) { ci++; continue; }
                let span = /lab/i.test(subj) ? 3 : 1;
                const endIdx = Math.min(headerTimes.length - 1, ci + span - 1);
                out.push({ day, subject: subj, startTime: headerTimes[ci].start, endTime: headerTimes[endIdx].end });
                ci += span;
            }
        });
        if (out.length) return out;
    }
    // Fallback line-by-line parser with fuzzy day detection
    const out2 = [];
    let currentDay = null;
    for (const raw of lines){
        let line = raw;
        const fd = fuzzyDayName(line);
        if (fd){
            currentDay = fd;
            // Remove fuzzy day token approximately
            const dname = fd.toLowerCase();
            if (line.toLowerCase().includes(dname)) {
                line = line.replace(new RegExp(dname,"i"), "").trim();
            }
        }
        if (!currentDay) continue;
        const m = line.match(/(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)[\s]*?(?:to|[-–]|TO)\s*?(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/i);
        if (!m) continue;
        const start = normalizeTime(m[1]);
        const end = normalizeTime(m[2]);
        let subject = line.replace(m[0],"").trim();
        subject = subject.replace(/[^\w\s\-&]+/g," ").trim() || "Class";
        if (isNonAcademicSubject(subject)) continue;
        if (isLunchCell(subject, start, end)) continue;
        out2.push({day: currentDay, subject, startTime: start, endTime: end});
    }
    return out2;
}

async function preprocessImage(file) {
    try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        const scale = Math.max(1, 1200 / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0,0,w,h);
        // grayscale + contrast/threshold
        for (let i=0; i<data.data.length; i+=4) {
            const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
            let y = 0.299*r + 0.587*g + 0.114*b;
            // increase contrast
            y = (y - 128) * 1.2 + 128;
            // adaptive threshold-like
            const v = y > 160 ? 255 : (y < 90 ? 0 : y);
            data.data[i] = data.data[i+1] = data.data[i+2] = v;
        }
        ctx.putImageData(data,0,0);
        return canvas;
    } catch {
        return file;
    }
}

function normalizeTime(t) {
    let s = t.toLowerCase().replace(/\./g, ":").replace(/\s+/g, "");
    const ampm = s.match(/am|pm/);
    s = s.replace(/am|pm/g, "");
    const [hh, mm] = s.split(":");
    let h = parseInt(hh, 10);
    const m = parseInt(mm || "00", 10);
    if (ampm && ampm[0] === "pm" && h < 12) h += 12;
    if (ampm && ampm[0] === "am" && h === 12) h = 0;
    const hh2 = String(h).padStart(2, "0");
    const mm2 = String(isNaN(m) ? 0 : m).padStart(2, "0");
    return `${hh2}:${mm2}`;
}

function renderOCRPreview(items) {
    const wrap = document.getElementById("ocrPreview");
    if (!wrap) return;
    wrap.innerHTML = items.map((it, idx) => {
        const unchecked = isNonAcademicSubject(it.subject) || isLunchCell(it.subject, it.startTime, it.endTime);
        return `<div class="ocr-item">
            <div class="ocr-day">${it.day}</div>
            <h4>${it.subject}</h4>
            <div>${it.startTime} - ${it.endTime}</div>
            <div class="ocr-actions"><label><input type="checkbox" data-idx="${idx}" ${unchecked ? "" : "checked"}> Include</label></div>
        </div>`;
    }).join("");
}

function saveExtractedTimetable() {
    const wrap = document.getElementById("ocrPreview");
    if (!wrap || !extractedTimetable || extractedTimetable.length === 0) return;
    const checks = wrap.querySelectorAll("input[type='checkbox'][data-idx]");
    const chosen = [];
    checks.forEach(ch => {
        if (ch.checked) {
            const i = parseInt(ch.getAttribute("data-idx"), 10);
            if (!isNaN(i) && extractedTimetable[i]) chosen.push(extractedTimetable[i]);
        }
    });
    if (chosen.length === 0) {
        showMessage("info", "Nothing selected");
        return;
    }
    chosen.forEach(it => {
        if (isNonAcademicSubject(it.subject)) return;
        timetable.push({ subject: it.subject, day: it.day, startTime: it.startTime, endTime: it.endTime });
        ensureSubjectExists(it.subject);
    });
    saveCloudData();
    renderSubjects();
    renderTimetable();
    showMessage("success", `Saved ${chosen.length} entries`);
    const btn = document.getElementById("ocrSaveBtn");
    if (btn) btn.disabled = true;
    scheduleReminders();
}
function showMessage(type, text) {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
    }
    toast.className = `toast ${type}`;
    toast.textContent = text;
    toast.style.display = "block";
    clearTimeout(lastMessageTimeout);
    lastMessageTimeout = setTimeout(() => {
        toast.style.display = "none";
    }, 3500);
}

function addHoursToTime(hhmm, hours) {
    const [hh, mm] = (hhmm || "00:00").split(":").map(v => parseInt(v,10) || 0);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    d.setTime(d.getTime() + hours * 60 * 60 * 1000);
    const h2 = String(d.getHours()).padStart(2,"0");
    const m2 = String(d.getMinutes()).padStart(2,"0");
    return `${h2}:${m2}`;
}

function subjectKey(name) {
    return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function ensureSubjectExists(name) {
    const n = (name || "").trim();
    if (!n) return;
    const key = subjectKey(n);
    const idx = subjects.findIndex(s => subjectKey(s.name) === key);
    if (idx === -1) {
        subjects.push({ name: n, attended: 0, total: 0, trend: [0] });
    }
}

function enableNotifications() {
    if (!("Notification" in window)) {
        showMessage("error", "Notifications not supported");
        return;
    }
    Notification.requestPermission().then(p => {
        if (p === "granted") {
            showMessage("success", "Notifications enabled");
            scheduleReminders();
        } else {
            showMessage("info", "Notifications permission denied");
        }
    });
}

function showNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body }); } catch {}
}

function scheduleReminders() {
    reminderTimers.forEach(t => clearTimeout(t));
    reminderTimers = [];
    if (!timetable || timetable.length === 0) return;
    const now = new Date();
    const dayIdx = {Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6};
    const today = now.getDay();
    const addTimer = (time, fn) => {
        const delay = time.getTime() - Date.now();
        if (delay > 500 && delay < 7 * 24 * 60 * 60 * 1000) {
            reminderTimers.push(setTimeout(fn, delay));
        }
    };
    timetable.forEach(item => {
        const dIdx = dayIdx[item.day] ?? -1;
        if (dIdx === -1) return;
        const base = new Date();
        const diff = (dIdx - today + 7) % 7;
        base.setDate(now.getDate() + diff);
        const [sh, sm] = (item.startTime || "00:00").split(":").map(x => parseInt(x,10)||0);
        base.setHours(sh, sm, 0, 0);
        const start = new Date(base.getTime());
        const pre = new Date(start.getTime() - 15 * 60 * 1000);
        const post = new Date(start.getTime() + 5 * 60 * 1000);
        addTimer(pre, () => {
            showNotification("Upcoming class", `${item.subject} at ${item.startTime}`);
            showMessage("info", `Class at ${item.startTime}: ${item.subject}`);
        });
        addTimer(post, () => {
            showNotification("Attendance", `${item.subject}: mark attendance`);
            showAttendancePrompt(item.subject);
        });
    });
}

function showAttendancePrompt(subject) {
    currentPromptSubject = subject;
    const modal = document.getElementById("attendancePrompt");
    const title = document.getElementById("promptTitle");
    if (title) title.textContent = `${subject}: mark attendance`;
    if (modal) modal.classList.remove("hidden");
}

// ===== ATTENDANCE PROMPT SYSTEM =====
let currentPromptSubject1 = null;

function subjectKey(name) {
    return name ? name.trim().toLowerCase().replace(/[^a-z]/g, '') : '';
}

function showAttendancePrompt(subject) {
    console.log("🎯 Prompt triggered for:", subject);
    currentPromptSubject1 = subject;
    const modal = document.getElementById('attendancePrompt');
    const title = document.getElementById('promptTitle');
    if (title) title.textContent = subject + ' - mark attendance';
    if (modal) modal.classList.remove('hidden');
    console.log("✅ Modal should be visible now");
}

function promptPresent() {
    console.log("🟢 PRESENT clicked! Subject:", currentPromptSubject);
    
    if (!currentPromptSubject1) {
        alert("No subject selected!");
        return;
    }
    
    // Find or create subject
    let idx = subjects.findIndex(s => subjectKey(s.name) === subjectKey(currentPromptSubject));
    if (idx === -1) {
        // Create new subject
        subjects.push({
            name: currentPromptSubject1,
            attended: 1,
            total: 1,
            trend: [100]
        });
        idx = subjects.length - 1;
        showMessage("success", `Created "${currentPromptSubject1}" & marked PRESENT`);
    } else {
        // Update existing
        subjects[idx].attended++;
        subjects[idx].total++;
        pushSubjectTrend(idx);
        showMessage("success", `"${subjects[idx].name}" marked PRESENT`);
    }
    
    // Update everything
    pushOverallTrend();
    saveCloudData();
    renderSubjects();
    closePrompt();
}

function promptAbsent() {
    console.log("🔴 ABSENT clicked! Subject:", currentPromptSubject1);
    
    if (!currentPromptSubject1) {
        alert("No subject selected!");
        return;
    }
    
    // Find or create subject
    let idx = subjects.findIndex(s => subjectKey(s.name) === subjectKey(currentPromptSubject));
    if (idx === -1) {
        // Create new subject (absent first class)
        subjects.push({
            name: currentPromptSubject1,
            attended: 0,
            total: 1,
            trend: [0]
        });
        idx = subjects.length - 1;
        showMessage("info", `Created "${currentPromptSubject1}" & marked ABSENT`);
    } else {
        // Update existing
        subjects[idx].total++;
        pushSubjectTrend(idx);
        showMessage("info", `"${subjects[idx].name}" marked ABSENT`);
    }
    
    // Update everything
    pushOverallTrend();
    saveCloudData();
    renderSubjects();
    closePrompt();
}

function closePrompt() {
    const modal = document.getElementById('attendancePrompt');
    if (modal) modal.classList.add('hidden');
    currentPromptSubject = null;
    console.log("❌ Prompt closed");
}

// ===== EXPOSE TO GLOBAL SCOPE (CRITICAL) =====
window.showAttendancePrompt = showAttendancePrompt;


window.enableNotifications = enableNotifications;
window.promptPresent = promptPresent;
window.promptAbsent = promptAbsent;
window.closePrompt = closePrompt;
