"use strict";
// ---------- 常數 ----------
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const PERIODS = ["1", "2", "3", "4", "N", "5", "6", "7", "8", "9", "A", "B", "C", "D"]; // N = 午休
const IS_N = i => PERIODS[i] === "N";
const ROW_H = i => (IS_N(i) ? 28 : 78);
const PALETTE = ["#e0b4a8", "#a9aed0", "#bba0c4", "#b9c9a6", "#cbbd9c", "#a4c0c8", "#c4b5a0", "#c9a0ac", "#9fb4c8", "#a8caa4", "#d6c18a", "#9ed0c4"];
const LS = { local: "tt.local.courses", sem: "tt.sem", sems: "tt.sems", opt: "tt.opt" };

// ---------- 狀態 ----------
const $ = s => document.querySelector(s);
const state = {
  courses: [],
  semester: localStorage.getItem(LS.sem) || defaultSemester(),
  semesters: JSON.parse(localStorage.getItem(LS.sems) || "[]"),
  opt: Object.assign({ weekend: false, night: false }, JSON.parse(localStorage.getItem(LS.opt) || "{}")),
  user: null,
};
function defaultSemester() {
  const d = new Date(), y = d.getFullYear() - 1911, m = d.getMonth() + 1;
  return m >= 8 ? `${y}-1` : m === 1 ? `${y - 1}-1` : `${y - 1}-2`;
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
  try { state.courses = await store.list(); }
  catch (e) { toast("讀取失敗:" + e.message); state.courses = []; }
  const set = new Set([...state.semesters, state.semester, ...state.courses.map(c => c.semester)]);
  state.semesters = [...set].sort().reverse();
  persistMeta();
  renderAll();
}
function persistMeta() {
  localStorage.setItem(LS.sem, state.semester);
  localStorage.setItem(LS.sems, JSON.stringify(state.semesters));
  localStorage.setItem(LS.opt, JSON.stringify(state.opt));
}

// ---------- 渲染 ----------
function visibleRows() {
  return PERIODS.map((p, i) => i).filter(i => state.opt.night || !"ABCD".includes(PERIODS[i]));
}
function renderAll() { renderSemesters(); renderGrid(); renderSummary(); }

function renderSemesters() {
  $("#semSelect").innerHTML = state.semesters
    .map(s => `<option value="${esc(s)}" ${s === state.semester ? "selected" : ""}>${esc(s)}</option>`).join("");
}

function renderGrid() {
  const nDays = state.opt.weekend ? 7 : 5;
  const rows = visibleRows();
  const tops = []; let y = 0;
  rows.forEach(i => { tops.push(y); y += ROW_H(i); });
  const total = y;

  document.documentElement.style.setProperty("--n", nDays);
  $("#days").innerHTML = "<div></div>" + DAYS.slice(0, nDays).map(d => `<div>${d}</div>`).join("");

  // 左側節次標籤與橫線(絕對定位),後面接 nDays 個欄位
  let html = "";
  rows.forEach((i, r) => {
    html += `<div class="plabel" style="top:${tops[r]}px;height:${ROW_H(i)}px">${PERIODS[i]}</div>`;
    html += `<div class="hline" style="top:${tops[r]}px"></div>`;
  });
  html += `<div class="hline" style="top:${total - 1}px"></div>`;
  html += `<div style="height:${total}px"></div>`; // 佔 label 欄
  for (let d = 0; d < nDays; d++) html += `<div class="col" data-day="${d}" style="height:${total}px"></div>`;
  const body = $("#body");
  body.innerHTML = html;
  const cols = [...body.querySelectorAll(".col")];

  // 展開所有時段
  const items = [];
  state.courses.filter(c => c.semester === state.semester).forEach(c => {
    (c.slots || []).forEach(s => {
      if (s.day >= nDays) return;
      const r0 = rows.findIndex(i => i >= s.start);
      let r1 = -1; rows.forEach((i, r) => { if (i <= s.end) r1 = r; });
      if (r0 < 0 || r1 < r0) return;
      items.push({ c, s, r0, r1, lane: 0, lanes: 1 });
    });
  });
  // 同日衝堂:並排
  for (let d = 0; d < nDays; d++) {
    const list = items.filter(x => x.s.day === d).sort((a, b) => a.r0 - b.r0 || a.r1 - b.r1);
    let cluster = [], end = -1;
    const flush = () => { const m = Math.max(1, ...cluster.map(x => x.lane + 1)); cluster.forEach(x => (x.lanes = m)); cluster = []; };
    for (const it of list) {
      if (it.r0 > end) { flush(); end = -1; }
      const used = cluster.filter(x => x.r1 >= it.r0).map(x => x.lane);
      let lane = 0; while (used.includes(lane)) lane++;
      it.lane = lane; cluster.push(it); end = Math.max(end, it.r1);
    }
    flush();
  }
  for (const it of items) {
    const top = tops[it.r0] + 2;
    const h = tops[it.r1] + ROW_H(rows[it.r1]) - tops[it.r0] - 4;
    const color = it.c.color || PALETTE[0];
    const el = document.createElement("div");
    el.className = "course" + (it.lanes > 1 ? " conflict" : "");
    el.style.cssText = `top:${top}px;height:${h}px;left:calc(${(it.lane / it.lanes) * 100}% + 2px);width:calc(${100 / it.lanes}% - 4px);background:${color};border-color:${shade(color, -0.35)}`;
    const room = it.s.room || it.c.room;
    el.innerHTML = `<b>${esc(it.c.name)}</b>${room ? `<small>${esc(room)}</small>` : ""}`;
    el.onclick = e => { e.stopPropagation(); openCourse(it.c); };
    cols[it.s.day].appendChild(el);
  }
  // 點空白新增
  cols.forEach(col => {
    col.onclick = e => {
      const yy = e.clientY - col.getBoundingClientRect().top;
      let r = tops.findIndex((t, k) => yy >= t && yy < t + ROW_H(rows[k]));
      if (r < 0) r = 0;
      let p = rows[r];
      if (IS_N(p)) p = rows[Math.min(r + 1, rows.length - 1)];
      openCourse(null, { day: +col.dataset.day, start: p, end: p });
    };
  });
}

function renderSummary() {
  const cs = state.courses.filter(c => c.semester === state.semester);
  const credits = cs.reduce((a, c) => a + (+c.credits || 0), 0);
  let hours = 0;
  cs.forEach(c => (c.slots || []).forEach(s => { for (let i = s.start; i <= s.end; i++) if (!IS_N(i)) hours++; }));
  $("#summary").textContent = `${credits.toFixed(1)} 學分 · ${hours} 小時`;
}

// ---------- 課程編輯 ----------
let editing = null, editColor = PALETTE[0];
const dlg = $("#courseDlg"), form = $("#courseForm");

const periodOpts = sel => PERIODS.map((p, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${p === "N" ? "N 午休" : "第 " + p + " 節"}</option>`).join("");
const dayOpts = sel => DAYS.map((d, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>週${d}</option>`).join("");

function addSlotRow(s) {
  const div = document.createElement("div");
  div.className = "slot";
  div.innerHTML = `<select class="d">${dayOpts(s.day)}</select>
    <select class="s">${periodOpts(s.start)}</select>
    <select class="e">${periodOpts(s.end)}</select>
    <button type="button" title="移除">✕</button>
    <input class="room" placeholder="此時段教室(選填,預設同上)" value="${esc(s.room || "")}">`;
  div.querySelector("button").onclick = () => div.remove();
  const sSel = div.querySelector(".s"), eSel = div.querySelector(".e");
  sSel.onchange = () => { if (+eSel.value < +sSel.value) eSel.value = sSel.value; };
  eSel.onchange = () => { if (+eSel.value < +sSel.value) sSel.value = eSel.value; };
  $("#slots").appendChild(div);
}

function openCourse(c, preset) {
  editing = c;
  $("#dlgTitle").textContent = c ? "編輯課程" : "新增課程";
  form.name.value = c?.name || "";
  form.room.value = c?.room || "";
  form.credits.value = c?.credits ?? 0;
  editColor = c?.color || PALETTE[state.courses.length % PALETTE.length];
  renderSwatches();
  $("#slots").innerHTML = "";
  (c?.slots?.length ? c.slots : [preset || { day: 0, start: 0, end: 1 }]).forEach(addSlotRow);
  $("#btnDelete").style.display = c ? "" : "none";
  dlg.showModal();
}
function renderSwatches() {
  $("#swatches").innerHTML = PALETTE.map(p => `<div class="sw ${p === editColor ? "on" : ""}" data-c="${p}" style="background:${p}"></div>`).join("");
  document.querySelectorAll(".sw").forEach(el => { el.onclick = () => { editColor = el.dataset.c; renderSwatches(); }; });
}
$("#addSlot").onclick = () => addSlotRow({ day: 0, start: 0, end: 1 });
$("#btnAdd").onclick = () => openCourse(null);
$("#btnCancel").onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  const slots = [...document.querySelectorAll("#slots .slot")].map(r => ({
    day: +r.querySelector(".d").value,
    start: +r.querySelector(".s").value,
    end: +r.querySelector(".e").value,
    room: r.querySelector(".room").value.trim() || undefined,
  }));
  if (!slots.length) return toast("至少要有一個上課時段");
  const course = {
    id: editing?.id || uid(),
    semester: editing?.semester || state.semester,
    name: form.name.value.trim(),
    room: form.room.value.trim(),
    credits: +form.credits.value || 0,
    color: editColor,
    slots,
  };
  const clash = findClash(course);
  if (clash && !confirm(`與「${clash}」衝堂,仍要儲存嗎?`)) return;
  try { await store.upsert(course); dlg.close(); await reload(); toast("已儲存"); }
  catch (err) { toast("儲存失敗:" + err.message); }
};
$("#btnDelete").onclick = async () => {
  if (!editing || !confirm(`刪除「${editing.name}」?`)) return;
  try { await store.remove(editing.id); dlg.close(); await reload(); toast("已刪除"); }
  catch (err) { toast("刪除失敗:" + err.message); }
};
function findClash(c) {
  for (const o of state.courses) {
    if (o.id === c.id || o.semester !== c.semester) continue;
    for (const a of c.slots) for (const b of o.slots || [])
      if (a.day === b.day && a.start <= b.end && b.start <= a.end) return o.name;
  }
  return null;
}

// ---------- 學期 / 設定 ----------
$("#semSelect").onchange = e => { state.semester = e.target.value; persistMeta(); renderAll(); };
$("#btnSem").onclick = () => {
  const s = prompt("新增學期(例如 115-2)", "");
  if (!s || !s.trim()) return;
  state.semester = s.trim();
  if (!state.semesters.includes(state.semester)) state.semesters.unshift(state.semester);
  persistMeta(); renderAll();
};
$("#btnSettings").onclick = () => {
  $("#optWeekend").checked = state.opt.weekend;
  $("#optNight").checked = state.opt.night;
  $("#setDlg").showModal();
};
$("#setDlg").onclose = () => {
  state.opt.weekend = $("#optWeekend").checked;
  state.opt.night = $("#optNight").checked;
  persistMeta(); renderGrid();
};

// ---------- 登入 ----------
let signUp = false;
const authDlg = $("#authDlg"), authForm = $("#authForm");
function setAuthMode() {
  $("#authTitle").textContent = signUp ? "註冊" : "登入";
  authForm.querySelector(".primary").textContent = signUp ? "註冊" : "登入";
  $("#authToggle").textContent = signUp ? "已有帳號?登入" : "沒有帳號?註冊";
}
$("#authToggle").onclick = () => { signUp = !signUp; setAuthMode(); };
$("#authCancel").onclick = () => authDlg.close();
$("#btnAuth").onclick = async () => {
  if (!sb) return toast("尚未設定 Supabase(見 config.js),目前為本機離線模式");
  if (state.user) { if (confirm("登出?")) await sb.auth.signOut(); return; }
  $("#authMsg").textContent = "";
  authDlg.showModal();
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
  $("#btnAuth").textContent = user ? "登出" : "登入";
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
  $("#btnAuth").style.opacity = 0.5;
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
