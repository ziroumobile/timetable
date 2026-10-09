"use strict";
// ---------- 常數 ----------
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
// 節次對應的時間(分鐘)。資料一律以「分鐘」儲存,節次只是顯示/輸入方式
const PERIODS = [
  { l: "1", s: 490, e: 540 }, { l: "2", s: 550, e: 600 }, { l: "3", s: 610, e: 660 }, { l: "4", s: 670, e: 720 },
  { l: "N", s: 730, e: 780 },
  { l: "5", s: 790, e: 840 }, { l: "6", s: 850, e: 900 }, { l: "7", s: 910, e: 960 }, { l: "8", s: 970, e: 1020 }, { l: "9", s: 1030, e: 1080 },
  { l: "A", s: 1095, e: 1145 }, { l: "B", s: 1150, e: 1200 }, { l: "C", s: 1210, e: 1260 }, { l: "D", s: 1265, e: 1315 },
];
const PERIOD_H = p => (p.l === "N" ? 28 : 78);
const HOUR_PX = 56;
const PALETTE = ["#e0b4a8", "#a9aed0", "#bba0c4", "#b9c9a6", "#cbbd9c", "#a4c0c8", "#c4b5a0", "#c9a0ac", "#9fb4c8", "#a8caa4", "#d6c18a", "#9ed0c4"];
const LS = { local: "tt.local.courses", sem: "tt.sem2", sems: "tt.sems", opt: "tt.opt", phr: "tt.phrases" };

// ---------- 狀態 ----------
const $ = s => document.querySelector(s);
const state = {
  courses: [],
  semester: localStorage.getItem(LS.sem) || defaultSemester(),
  semesters: JSON.parse(localStorage.getItem(LS.sems) || "[]"),
  opt: Object.assign({ weekend: false, night: false, period: false, keys: "7, 12, 18" }, JSON.parse(localStorage.getItem(LS.opt) || "{}")),
  user: null,
};
function defaultSemester() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const keyHours = () => new Set(String(state.opt.keys).split(/[,\s、，]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 24));

// 舊資料(以節次 index 存)轉成分鐘
function normalize(c) {
  c.slots = (c.slots || []).map(s => {
    if (s.from != null && s.to != null) return s;
    const a = PERIODS[s.start], b = PERIODS[s.end];
    return a && b ? { day: s.day, from: a.s, to: b.e, room: s.room } : null;
  }).filter(Boolean);
  return c;
}

// ---------- 儲存層 (Supabase / localStorage) ----------
const sb = window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

const localAll = () => JSON.parse(localStorage.getItem(LS.local) || "[]");
const localSave = a => localStorage.setItem(LS.local, JSON.stringify(a));
const uid = () => crypto.randomUUID();

const store = {
  async list() {
    if (state.user) {
      const { data, error } = await sb.from("courses").select("*").order("created_at");
      if (error) throw error;
      return data;
    }
    return localAll();
  },
  async upsert(c) {
    if (state.user) {
      const { error } = await sb.from("courses").upsert(c);
      if (error) throw error;
      return;
    }
    const a = localAll(), i = a.findIndex(x => x.id === c.id);
    if (i >= 0) a[i] = c; else a.push(c);
    localSave(a);
  },
  async remove(id) {
    if (state.user) {
      const { error } = await sb.from("courses").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    localSave(localAll().filter(x => x.id !== id));
  },
};

// ---------- 載入 ----------
async function reload() {
  try { state.courses = (await store.list()).map(normalize); }
  catch (e) { toast("讀取失敗:" + e.message); state.courses = []; }
  const set = new Set([...state.semesters, state.semester, ...state.courses.map(c => c.semester)]);
  const used = new Set(state.courses.map(c => c.semester));
  state.semesters = [...set].filter(s => used.has(s) || s === state.semester).sort().reverse();
  persistMeta();
  renderAll();
}
function persistMeta() {
  localStorage.setItem(LS.sem, state.semester);
  localStorage.setItem(LS.sems, JSON.stringify(state.semesters));
  localStorage.setItem(LS.opt, JSON.stringify(state.opt));
}

// ---------- 時間工具 ----------
const pad = n => String(n).padStart(2, "0");
const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const parseT = v => { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); };
const periodAtOrAfter = m => { const i = PERIODS.findIndex(p => p.e > m); return i < 0 ? PERIODS.length - 1 : i; };
const periodAtOrBefore = m => { let r = 0; PERIODS.forEach((p, i) => { if (p.s < m) r = i; }); return r; };

// ---------- 軸線(時間模式 / 節次模式) ----------
function buildAxis() {
  const nDays = state.opt.weekend ? 7 : 5;
  const items = [];
  state.courses.filter(c => c.semester === state.semester)
    .forEach(c => c.slots.forEach(s => { if (s.day < nDays) items.push({ c, s }); }));

  if (state.opt.period) {
    const rows = PERIODS.filter(p => state.opt.night || !"ABCD".includes(p.l));
    const tops = []; let y = 0;
    rows.forEach(p => { tops.push(y); y += PERIOD_H(p); });
    const lines = rows.map((p, i) => ({ y: tops[i], h: PERIOD_H(p), label: p.l, center: true }));
    const yRange = s => {
      const r0 = rows.findIndex(p => p.e > s.from);
      let r1 = -1; rows.forEach((p, i) => { if (p.s < s.to) r1 = i; });
      return r0 < 0 || r1 < r0 ? null : [tops[r0], tops[r1] + PERIOD_H(rows[r1])];
    };
    const toTime = yy => {
      let r = tops.findIndex((t, k) => yy >= t && yy < t + PERIOD_H(rows[k]));
      if (r < 0) r = 0;
      if (rows[r].l === "N") r = Math.min(r + 1, rows.length - 1);
      return [rows[r].s, rows[r].e];
    };
    return { nDays, items, lines, total: y, yRange, toTime };
  }

  let lo = 7 * 60, hi = 22 * 60;
  items.forEach(({ s }) => { lo = Math.min(lo, Math.floor(s.from / 60) * 60); hi = Math.max(hi, Math.ceil(s.to / 60) * 60); });
  const px = HOUR_PX / 60, keys = keyHours();
  const lines = [];
  for (let h = lo / 60; h <= hi / 60; h++) lines.push({ y: (h * 60 - lo) * px, label: String(h), key: keys.has(h) });
  return {
    nDays, items, lines, total: (hi - lo) * px,
    yRange: s => [(s.from - lo) * px, (s.to - lo) * px],
    toTime: yy => { const m = lo + Math.floor(yy / px / 60) * 60; return [m, m + 60]; },
  };
}

// ---------- 渲染 ----------
function renderAll() { renderSemesters(); renderGrid(); renderAccount(); }

function renderSemesters() {
  $("#semSelect").innerHTML = state.semesters
    .map(s => `<option value="${esc(s)}" ${s === state.semester ? "selected" : ""}>${esc(s)}</option>`).join("");
}

function renderGrid() {
  const ax = buildAxis();
  document.documentElement.style.setProperty("--n", ax.nDays);
  $("#days").innerHTML = "<div></div>" + DAYS.slice(0, ax.nDays).map(d => `<div>${d}</div>`).join("");

  let html = "";
  ax.lines.forEach(l => {
    html += `<div class="hline ${l.key ? "key" : ""}" style="top:${l.y}px"></div>`;
    html += l.center
      ? `<div class="plabel" style="top:${l.y}px;height:${l.h}px">${l.label}</div>`
      : `<div class="tlabel ${l.key ? "key" : ""}" style="top:${l.y}px">${l.label}</div>`;
  });
  if (ax.lines[0]?.center) html += `<div class="hline" style="top:${ax.total - 1}px"></div>`;
  html += `<div style="height:${ax.total}px"></div>`; // 佔 label 欄
  for (let d = 0; d < ax.nDays; d++) html += `<div class="col" data-day="${d}" style="height:${ax.total}px"></div>`;
  const body = $("#body");
  body.innerHTML = html;
  const cols = [...body.querySelectorAll(".col")];

  const items = ax.items.map(({ c, s }) => {
    const r = ax.yRange(s);
    return r && { c, s, top: r[0], bottom: r[1], lane: 0, lanes: 1 };
  }).filter(Boolean);

  // 同日重疊:並排
  for (let d = 0; d < ax.nDays; d++) {
    const list = items.filter(x => x.s.day === d).sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    let cluster = [], end = -Infinity;
    const flush = () => { const m = Math.max(1, ...cluster.map(x => x.lane + 1)); cluster.forEach(x => (x.lanes = m)); cluster = []; };
    for (const it of list) {
      if (it.top >= end) { flush(); end = -Infinity; }
      const used = cluster.filter(x => x.bottom > it.top).map(x => x.lane);
      let lane = 0; while (used.includes(lane)) lane++;
      it.lane = lane; cluster.push(it); end = Math.max(end, it.bottom);
    }
    flush();
  }
  for (const it of items) {
    const h = it.bottom - it.top - 4;
    const color = it.c.color || PALETTE[0];
    const el = document.createElement("div");
    el.className = "course" + (it.lanes > 1 ? " conflict" : "");
    el.style.cssText = `top:${it.top + 2}px;height:${h}px;left:calc(${(it.lane / it.lanes) * 100}% + 2px);width:calc(${100 / it.lanes}% - 4px);background:${color};border-color:${shade(color, -0.35)}`;
    const room = it.s.room || it.c.room;
    el.innerHTML = `<b>${esc(it.c.name)}</b>${room ? `<small>${esc(room)}</small>` : ""}` +
      (!state.opt.period && h > 64 ? `<small class="t">${fmt(it.s.from)}–${fmt(it.s.to)}</small>` : "");
    bindPress(el, it.c);
    cols[it.s.day].appendChild(el);
  }
  // 點空白新增
  cols.forEach(col => {
    col.onclick = e => {
      const [from, to] = ax.toTime(e.clientY - col.getBoundingClientRect().top);
      openCourse(null, { day: +col.dataset.day, from, to });
    };
  });
}

// ---------- 長按看詳情 ----------
function bindPress(el, c) {
  let timer = null, fired = false, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.onpointerdown = e => {
    fired = false; x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { fired = true; timer = null; navigator.vibrate?.(15); showInfo(c); }, 450);
  };
  el.onpointermove = e => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cancel(); };
  el.onpointerup = el.onpointerleave = el.onpointercancel = cancel;
  el.oncontextmenu = e => e.preventDefault();
  el.onclick = e => { e.stopPropagation(); if (fired) { fired = false; return; } openCourse(c); };
}
function showInfo(c) {
  $("#infoName").textContent = c.name;
  $("#infoRoom").textContent = c.room || "—";
  $("#infoTimes").innerHTML = c.slots.slice().sort((p, q) => p.day - q.day || p.from - q.from)
    .map(s => `<li>週${DAYS[s.day]} ${fmt(s.from)}–${fmt(s.to)}${s.room && s.room !== c.room ? ` <span class="muted">· ${esc(s.room)}</span>` : ""}</li>`).join("");
  $("#btnInfoEdit").onclick = () => { $("#infoDlg").close(); openCourse(c); };
  $("#infoDlg").showModal();
}
$("#btnInfoClose").onclick = () => $("#infoDlg").close();
$("#infoDlg").onclick = e => { if (e.target === e.currentTarget) e.currentTarget.close(); };

// ---------- 課程編輯 ----------
let editing = null, editColor = PALETTE[0];
const dlg = $("#courseDlg"), form = $("#courseForm");

const periodOpts = sel => PERIODS.map((p, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${p.l === "N" ? "N 午休" : "第 " + p.l + " 節"}</option>`).join("");
const dayOpts = sel => DAYS.map((d, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>週${d}</option>`).join("");

function addSlotRow(s) {
  const div = document.createElement("div");
  div.className = "slot";
  const roomInput = `<input class="room" placeholder="此時段地點(選填,預設同上)" value="${esc(s.room || "")}">`;
  if (state.opt.period) {
    div.innerHTML = `<select class="d">${dayOpts(s.day)}</select>
      <select class="s">${periodOpts(periodAtOrAfter(s.from))}</select>
      <select class="e">${periodOpts(periodAtOrBefore(s.to))}</select>
      <button type="button" title="移除">✕</button>${roomInput}`;
    const sSel = div.querySelector(".s"), eSel = div.querySelector(".e");
    sSel.onchange = () => { if (+eSel.value < +sSel.value) eSel.value = sSel.value; };
    eSel.onchange = () => { if (+eSel.value < +sSel.value) sSel.value = eSel.value; };
  } else {
    div.innerHTML = `<select class="d">${dayOpts(s.day)}</select>
      <input class="from" type="time" step="300" value="${fmt(s.from)}" required>
      <input class="to" type="time" step="300" value="${fmt(s.to)}" required>
      <button type="button" title="移除">✕</button>${roomInput}`;
  }
  div.querySelector("button").onclick = () => div.remove();
  $("#slots").appendChild(div);
}
function readSlot(r) {
  const day = +r.querySelector(".d").value;
  const room = r.querySelector(".room").value.trim() || undefined;
  if (state.opt.period) {
    return { day, from: PERIODS[+r.querySelector(".s").value].s, to: PERIODS[+r.querySelector(".e").value].e, room };
  }
  return { day, from: parseT(r.querySelector(".from").value), to: parseT(r.querySelector(".to").value), room };
}

// ---------- 常用詞 ----------
const phrases = () => Object.assign({ name: [], room: [] }, JSON.parse(localStorage.getItem(LS.phr) || "{}"));
function renderPhrases() {
  const all = phrases();
  document.querySelectorAll(".phr").forEach(box => {
    const f = box.dataset.f;
    box.innerHTML = all[f].map((w, i) => `<span class="ph" data-i="${i}"><b>${esc(w)}</b><i title="移除">✕</i></span>`).join("")
      + `<button type="button" class="chipAdd" title="把目前輸入的內容存成常用詞">＋</button>`;
    box.querySelectorAll(".ph[data-i]").forEach(ch => {
      ch.querySelector("b").onclick = () => { form[f].value = all[f][+ch.dataset.i]; form[f].focus(); };
      ch.querySelector("i").onclick = () => {
        all[f].splice(+ch.dataset.i, 1);
        localStorage.setItem(LS.phr, JSON.stringify(all)); renderPhrases();
      };
    });
    box.querySelector(".chipAdd").onclick = () => {
      const v = form[f].value.trim();
      if (!v) return toast("先在上面輸入內容,再按 ＋ 儲存");
      if (all[f].includes(v)) return toast("已經存過了");
      all[f].push(v);
      localStorage.setItem(LS.phr, JSON.stringify(all)); renderPhrases(); toast("已存成常用詞");
    };
  });
}

function openCourse(c, preset) {
  editing = c;
  $("#dlgTitle").textContent = c ? "編輯名稱" : "新增名稱";
  form.name.value = c?.name || "";
  form.room.value = c?.room || "";
  editColor = c?.color || PALETTE[state.courses.length % PALETTE.length];
  renderSwatches();
  renderPhrases();
  $("#slots").innerHTML = "";
  (c?.slots?.length ? c.slots : [preset || { day: 0, from: 480, to: 540 }]).forEach(addSlotRow);
  $("#btnDelete").style.display = c ? "" : "none";
  dlg.showModal();
}
function renderSwatches() {
  $("#swatches").innerHTML = PALETTE.map(p => `<div class="sw ${p === editColor ? "on" : ""}" data-c="${p}" style="background:${p}"></div>`).join("");
  document.querySelectorAll(".sw").forEach(el => { el.onclick = () => { editColor = el.dataset.c; renderSwatches(); }; });
}
$("#addSlot").onclick = () => addSlotRow({ day: 0, from: 480, to: 540 });
$("#btnAdd").onclick = () => openCourse(null);
$("#btnCancel").onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  const slots = [...document.querySelectorAll("#slots .slot")].map(readSlot);
  if (!slots.length) return toast("至少要有一個上課時段");
  if (slots.some(s => !(s.to > s.from))) return toast("結束時間要晚於開始時間");
  const course = {
    id: editing?.id || uid(),
    semester: editing?.semester || state.semester,
    name: form.name.value.trim(),
    room: form.room.value.trim(),
    credits: editing?.credits ?? 0,
    color: editColor,
    slots,
  };
  const clash = findClash(course);
  if (clash && !confirm(`與「${clash}」時間重疊,仍要儲存嗎?`)) return;
  // 先更新畫面再背景寫入,不用等網路
  const i = state.courses.findIndex(x => x.id === course.id);
  if (i >= 0) state.courses[i] = course; else state.courses.push(course);
  dlg.close(); renderAll(); toast("已儲存");
  try { await store.upsert(course); }
  catch (err) { toast("儲存失敗:" + err.message); await reload(); }
};
$("#btnDelete").onclick = async () => {
  if (!editing || !confirm(`刪除「${editing.name}」?`)) return;
  const id = editing.id;
  state.courses = state.courses.filter(x => x.id !== id);
  dlg.close(); renderAll(); toast("已刪除");
  try { await store.remove(id); }
  catch (err) { toast("刪除失敗:" + err.message); await reload(); }
};
function findClash(c) {
  for (const o of state.courses) {
    if (o.id === c.id || o.semester !== c.semester) continue;
    for (const a of c.slots) for (const b of o.slots)
      if (a.day === b.day && a.from < b.to && b.from < a.to) return o.name;
  }
  return null;
}

// ---------- 時間表切換 / 設定 ----------
$("#semSelect").onchange = e => { state.semester = e.target.value; persistMeta(); renderAll(); };
$("#btnSem").onclick = () => {
  const s = prompt("新增時間表(例如 2026/11)", "");
  if (!s || !s.trim()) return;
  state.semester = s.trim();
  if (!state.semesters.includes(state.semester)) state.semesters.unshift(state.semester);
  persistMeta(); renderAll();
};
$("#btnSettings").onclick = () => {
  $("#optWeekend").checked = state.opt.weekend;
  $("#optNight").checked = state.opt.night;
  $("#optPeriod").checked = state.opt.period;
  $("#optKeys").value = state.opt.keys;
  renderAccount();
  renderInstall();
  $("#setDlg").showModal();
};
$("#setDlg").onclose = () => {
  state.opt.weekend = $("#optWeekend").checked;
  state.opt.night = $("#optNight").checked;
  state.opt.period = $("#optPeriod").checked;
  state.opt.keys = $("#optKeys").value;
  persistMeta(); renderGrid();
};

// ---------- 帳號 ----------
let signUp = false;
const authDlg = $("#authDlg"), authForm = $("#authForm");
function setAuthMode() {
  $("#authTitle").textContent = signUp ? "註冊" : "登入";
  authForm.querySelector(".primary").textContent = signUp ? "註冊" : "登入";
  $("#authToggle").textContent = signUp ? "已有帳號?登入" : "沒有帳號?註冊";
}
$("#authToggle").onclick = () => { signUp = !signUp; setAuthMode(); };
$("#authCancel").onclick = () => authDlg.close();

function renderAccount() {
  $("#btnAuth").hidden = !sb || !!state.user; // 標題列只在未登入時顯示「登入」
  const info = $("#acctInfo"), btn = $("#btnAcct");
  if (!sb) { info.textContent = "尚未設定 Supabase,目前為本機離線模式。"; btn.hidden = true; return; }
  btn.hidden = false;
  info.textContent = state.user ? `已登入:${state.user.email}` : "尚未登入,資料只存在這個瀏覽器。";
  btn.textContent = state.user ? "登出" : "登入";
}
function openAuth() { $("#authMsg").textContent = ""; authDlg.showModal(); }
$("#btnAuth").onclick = openAuth;
$("#btnAcct").onclick = async () => {
  $("#setDlg").close();
  if (state.user) { if (confirm("登出?")) await sb.auth.signOut(); }
  else openAuth();
};
authForm.onsubmit = async e => {
  e.preventDefault();
  const email = authForm.email.value.trim(), password = authForm.password.value;
  const msg = $("#authMsg"); msg.className = "msg"; msg.textContent = "處理中…";
  const { data, error } = signUp
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { msg.textContent = error.message; return; }
  if (signUp && !data.session) { msg.className = "msg ok"; msg.textContent = "請到信箱點驗證連結後再登入"; return; }
  authDlg.close();
};
async function onUser(user) {
  const first = !state.user && user;
  state.user = user;
  if (first) {
    const loc = localAll();
    if (loc.length && confirm(`偵測到本機有 ${loc.length} 門離線課程,要上傳到你的帳號嗎?`)) {
      const { error } = await sb.from("courses").insert(loc.map(c => ({ ...c, id: uid() })));
      if (error) toast("上傳失敗:" + error.message); else { localSave([]); toast("已上傳"); }
    }
  }
  await reload();
}
if (sb) {
  sb.auth.getSession().then(({ data }) => onUser(data.session?.user || null));
  sb.auth.onAuthStateChange((_e, s) => { const u = s?.user || null; if (u?.id !== state.user?.id) onUser(u); });
} else {
  reload();
}

// ---------- 工具 ----------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
let tt;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2200); }

// ---------- 安裝成 App (PWA) ----------
let installEvt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function renderInstall() {
  const box = $("#installBox");
  if (isStandalone()) { box.hidden = true; return; }
  if (installEvt) { box.hidden = false; $("#installHint").textContent = "加入主畫面,像 App 一樣使用"; $("#btnInstall").hidden = false; }
  else if (isIOS) { box.hidden = false; $("#installHint").textContent = "在 Safari 按下方「分享」→「加入主畫面」"; $("#btnInstall").hidden = true; }
  else box.hidden = true;
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderInstall(); });
window.addEventListener("appinstalled", () => { installEvt = null; renderInstall(); toast("已安裝"); });
$("#btnInstall").onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null; renderInstall();
};
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
