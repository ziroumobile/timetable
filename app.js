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
const PALETTE = ["#e0b4a8", "#a9aed0", "#bba0c4", "#b9c9a6", "#cbbd9c", "#a4c0c8", "#c4b5a0", "#c9a0ac", "#9fb4c8", "#a8caa4", "#d6c18a", "#9ed0c4",
  "#e8a0a0", "#f0b27a", "#f2d16b", "#b5d96b", "#7fcf9b", "#6fd0d0", "#7fb8e8", "#8a9be8", "#b08ae8", "#e08ad0", "#d0d3dc", "#a3a8b8"];
const LS = { local: "tt.local.courses", sem: "tt.sem2", sems: "tt.sems", opt: "tt.opt", phr: "tt.phrases" };

// ---------- 狀態 ----------
const $ = s => document.querySelector(s);
const state = {
  courses: [],
  semester: localStorage.getItem(LS.sem) || defaultSemester(),
  semesters: JSON.parse(localStorage.getItem(LS.sems) || "[]"),
  opt: Object.assign({ weekend: true, sunFirst: false, rest: false, notifyOn: false, notifyLead: 0, off: [], locked: [], ghost: [], night: false, period: false, keys: "7, 12, 18" }, JSON.parse(localStorage.getItem(LS.opt) || "{}")),
  user: null,
  view: "week",            // week = 每週課表(預設), month = 行事曆(從左上選單切換)
  anchor: new Date(),      // 目前選的日期(決定哪一週)
  month: { y: new Date().getFullYear(), m: new Date().getMonth() },
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
      let { error } = await sb.from("courses").upsert(c);
      if (error && /note/.test(error.message || "")) { // 雲端還沒加 note 欄位:先存其他資料,提醒一次
        const { note, ...rest } = c;
        ({ error } = await sb.from("courses").upsert(rest));
        if (!error && note) toast("備註尚未同步到雲端,請先在 Supabase 加入 note 欄位");
      }
      if (error) throw error;
      return;
    }
    const a = localAll(), i = a.findIndex(x => x.id === c.id);
    if (i >= 0) a[i] = c; else a.push(c);
    localSave(a);
  },
  async upsertMany(list) {
    if (!list.length) return;
    if (state.user) {
      let { error } = await sb.from("courses").upsert(list);
      if (error && /note/.test(error.message || "")) ({ error } = await sb.from("courses").upsert(list.map(({ note, ...r }) => r)));
      if (error) throw error;
      return;
    }
    const a = localAll();
    list.forEach(c => { const i = a.findIndex(x => x.id === c.id); if (i >= 0) a[i] = c; else a.push(c); });
    localSave(a);
  },
  async removeSemester(sem) {
    if (state.user) {
      const { error } = await sb.from("courses").delete().eq("semester", sem);
      if (error) throw error;
      return;
    }
    localSave(localAll().filter(x => x.semester !== sem));
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
// 時長顯示:不到 1 小時只顯示分鐘
const fmtDur = m => m < 60 ? `${m} 分鐘` : (m % 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘` : `${m / 60} 小時`);
// 輸入時間:可直接打 830、0830、8:30、8.30、14 等,全形也行;回傳分鐘,格式不對回傳 NaN
function parseTimeInput(str) {
  const s = String(str || "").trim().replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).replace(/[：．。.,，]/g, ":").replace(/\s+/g, "");
  let h, m;
  let r;
  if ((r = /^(\d{1,2}):(\d{1,2})$/.exec(s))) { h = +r[1]; m = +r[2]; }
  else if ((r = /^(\d{1,2})$/.exec(s))) { h = +r[1]; m = 0; }
  else if ((r = /^(\d{1,2})(\d{2})$/.exec(s))) { h = +r[1]; m = +r[2]; }
  else return NaN;
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return NaN;
  return h * 60 + m;
}
const parseT = v => { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); };
const periodAtOrAfter = m => { const i = PERIODS.findIndex(p => p.e > m); return i < 0 ? PERIODS.length - 1 : i; };
const periodAtOrBefore = m => { let r = 0; PERIODS.forEach((p, i) => { if (p.s < m) r = i; }); return r; };

// ---------- 週 / 日期工具 ----------
// 資料裡 day: 0=週一 … 6=週日。顯示順序由設定決定(一到日 或 日到六)
const dayOrder = () => state.opt.weekend ? (state.opt.sunFirst ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4];
const dayOfDate = d => (d.getDay() + 6) % 7;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (p, q) => p.getFullYear() === q.getFullYear() && p.getMonth() === q.getMonth() && p.getDate() === q.getDate();
function weekStart(d) { return addDays(d, state.opt.sunFirst ? -d.getDay() : -dayOfDate(d)); }
function dateOfDay(di) { // 這一週裡 day index 對應的日期
  const off = state.opt.sunFirst ? (di === 6 ? 0 : di + 1) : di;
  return addDays(weekStart(state.anchor), off);
}

// ---------- 軸線(時間模式 / 節次模式) ----------
function buildAxis() {
  const order = dayOrder(), nDays = order.length;
  const items = [];
  state.courses.filter(c => c.semester === state.semester)
    .forEach(c => c.slots.forEach(s => { if (order.includes(s.day)) items.push({ c, s }); }));

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
    const yMin = (yy, end) => {
      const r = tops.findIndex((t, k) => yy > t - 0.5 && yy < t + PERIOD_H(rows[k]) + 0.5 && (end ? yy > t + 0.5 : yy < t + PERIOD_H(rows[k]) - 0.5));
      const row = rows[r < 0 ? (end ? rows.length - 1 : 0) : r];
      return end ? row.e : row.s;
    };
    return { nDays, order, items, lines, total: y, yRange, toTime, yMin };
  }

  // 預設顯示 06:00–22:00;有行程超出才往外多顯示 1 小時
  let lo = 6 * 60, hi = 22 * 60;
  if (items.length) {
    const mn = Math.min(...items.map(x => x.s.from)), mx = Math.max(...items.map(x => x.s.to));
    if (mn < lo) lo = Math.max(0, Math.floor(mn / 60) * 60 - 60);
    if (mx > hi) hi = Math.min(24 * 60, Math.ceil(mx / 60) * 60 + 60);
  }
  const px = HOUR_PX / 60, BRK = 26, keys = keyHours();

  // 開啟休息時:每一天都沒行程、且超過 4 小時的空檔,只留前 2 小時和後 2 小時,中間省略
  const cuts = [];
  if (state.opt.rest) {
    const iv = items.map(({ s }) => [Math.max(lo, s.from), Math.min(hi, s.to)]).filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0]);
    let pos = lo; const free = [];
    for (const [p, q] of iv) { if (p > pos) free.push([pos, p]); pos = Math.max(pos, q); }
    if (pos < hi) free.push([pos, hi]);
    for (const [fs0, fe] of free) {
      if (fe - fs0 <= 240) continue;
      const cs = Math.ceil((fs0 + 120) / 60) * 60, ce = Math.floor((fe - 120) / 60) * 60;
      if (ce - cs >= 60) cuts.push([cs, ce]);
    }
  }
  const segs = [], breaks = []; let m = lo, y = 0;
  for (const [cs, ce] of cuts) {
    segs.push({ m0: m, m1: cs, y0: y }); y += (cs - m) * px;
    breaks.push({ y, h: BRK, from: cs, to: ce }); y += BRK; m = ce;
  }
  segs.push({ m0: m, m1: hi, y0: y }); y += (hi - m) * px;
  const total = y;
  const yOf = mm => { const g = segs.find(g => mm >= g.m0 && mm <= g.m1) || segs[segs.length - 1]; return g.y0 + (Math.min(Math.max(mm, g.m0), g.m1) - g.m0) * px; };
  const lines = [];
  segs.forEach(g => { for (let hh = Math.ceil(g.m0 / 60); hh <= Math.floor(g.m1 / 60); hh++) lines.push({ y: g.y0 + (hh * 60 - g.m0) * px, label: String(hh), key: keys.has(hh) }); });
  return {
    nDays, order, items, lines, breaks, total,
    yRange: s => [yOf(s.from), yOf(s.to)],
    toTime: yy => {
      const g = segs.find(g => yy >= g.y0 && yy < g.y0 + (g.m1 - g.m0) * px);
      if (!g) { const b = breaks.find(b => yy >= b.y && yy < b.y + b.h); return b ? [b.from - 60, b.from] : [hi - 60, hi]; }
      const mm = Math.floor((g.m0 + (yy - g.y0) / px) / 60) * 60; return [mm, mm + 60];
    },
    yMin: yy => { const g = segs.find(g => yy >= g.y0 - 0.5 && yy <= g.y0 + (g.m1 - g.m0) * px + 0.5) || segs[segs.length - 1]; return Math.round(g.m0 + (yy - g.y0) / px); },
  };
}

// ---------- 渲染 ----------
function renderAll() { renderSemesters(); renderAccount(); renderMain(); }
function renderMain() {
  const week = state.view === "week";
  $("#monthView").hidden = week; $("main").hidden = !week;
  document.querySelectorAll("#menuPop button").forEach(b => b.classList.toggle("on", b.dataset.v === state.view));
  if (week) {
    renderWeekBar(); renderGrid();
  } else renderMonth();
}
function renderWeekBar() {
  const s = weekStart(state.anchor), e = addDays(s, 6), f = d => `${d.getMonth() + 1}/${d.getDate()}`;
  $("#weekLbl").textContent = `${s.getFullYear()}年 ${f(s)} – ${f(e)}`;
}
function renderMonth() {
  const { y, m } = state.month;
  $("#mTitle").textContent = `${y}年${m + 1}月`;
  const labels = state.opt.sunFirst ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  $("#mDow").innerHTML = labels.map(i => `<div>${DAYS[i]}</div>`).join("");
  const first = new Date(y, m, 1), start = weekStart(first);
  const rows = Math.ceil((Math.round((first - start) / 864e5) + new Date(y, m + 1, 0).getDate()) / 7);
  const cur = state.courses.filter(c => c.semester === state.semester);
  const off = new Set(state.opt.off || []), today = new Date();
  let html = "";
  for (let i = 0; i < rows * 7; i++) {
    const d = addDays(start, i), di = dayOfDate(d);
    const colors = off.has(di) ? [] : [...new Set(cur.filter(c => c.slots.some(s => s.day === di && !isGhost(c, s))).map(c => c.color || PALETTE[0]))].slice(0, 4);
    html += `<button type="button" class="mc ${d.getMonth() !== m ? "out" : ""} ${sameDay(d, today) ? "today" : ""} ${off.has(di) ? "offd" : ""}" data-t="${d.getTime()}"><span>${d.getDate()}</span><i>${colors.map(k => `<u style="background:${k}"></u>`).join("")}</i></button>`;
  }
  $("#mGrid").innerHTML = html;
  $("#mGrid").querySelectorAll(".mc").forEach(el => { el.onclick = () => { state.anchor = new Date(+el.dataset.t); state.view = "week"; renderMain(); window.scrollTo(0, 0); }; });
}
const moveMonth = n => { const d = new Date(state.month.y, state.month.m + n, 1); state.month = { y: d.getFullYear(), m: d.getMonth() }; renderMonth(); };
$("#mPrev").onclick = () => moveMonth(-1);
$("#mNext").onclick = () => moveMonth(1);
$("#mToday").onclick = () => { const t = new Date(); state.month = { y: t.getFullYear(), m: t.getMonth() }; renderMonth(); };
$("#wPrev").onclick = () => { state.anchor = addDays(state.anchor, -7); renderMain(); };
$("#wNext").onclick = () => { state.anchor = addDays(state.anchor, 7); renderMain(); };
// 左上角選單:切換 週課表 / 行事曆
const menuPop = $("#menuPop");
$("#btnMenu").onclick = e => { e.stopPropagation(); menuPop.hidden = !menuPop.hidden; };
document.addEventListener("click", () => { menuPop.hidden = true; });
menuPop.querySelectorAll("button").forEach(b => {
  b.onclick = () => {
    if (b.dataset.v === "month") state.month = { y: state.anchor.getFullYear(), m: state.anchor.getMonth() };
    state.view = b.dataset.v; menuPop.hidden = true; renderMain(); window.scrollTo(0, 0);
  };
});

function renderSemesters() {
  const box = $("#semTabs");
  box.innerHTML = [...state.semesters].sort()
    .map(s => `<button type="button" role="tab" class="tab ${s === state.semester ? "on" : ""}" data-s="${esc(s)}">${isLocked(s) ? "🔒 " : ""}${esc(s)}</button>`).join("");
  box.querySelectorAll(".tab").forEach(t => bindPress(t, () => openSheet(t.dataset.s), () => { state.semester = t.dataset.s; persistMeta(); renderAll(); }));
  box.querySelector(".tab.on")?.scrollIntoView({ inline: "center", block: "nearest" });
}

// 點星期標題:整天變半透明(補假/停課),再點一次恢復
function toggleOff(d) {
  const s = new Set(state.opt.off || []);
  if (s.has(d)) s.delete(d); else s.add(d);
  state.opt.off = [...s];
  persistMeta(); renderMain();
  toast(s.has(d) ? `週${DAYS[d]}已標示放假` : `週${DAYS[d]}已恢復`);
}

function renderGrid() {
  const ax = buildAxis();
  document.documentElement.style.setProperty("--n", ax.nDays);
  const off = new Set(state.opt.off || []);
  $("#days").innerHTML = "<div></div>" + ax.order.map(i => `<div class="dh ${off.has(i) ? "off" : ""}" data-d="${i}">${DAYS[i]}<span class="dd">${dateOfDay(i).getDate()}</span></div>`).join("");
  $("#days").querySelectorAll(".dh").forEach(el => { el.onclick = () => toggleOff(+el.dataset.d); });

  let html = "";
  ax.lines.forEach(l => {
    html += `<div class="hline ${l.key ? "key" : ""}" style="top:${l.y}px"></div>`;
    html += l.center
      ? `<div class="plabel" style="top:${l.y}px;height:${l.h}px">${l.label}</div>`
      : `<div class="tlabel ${l.key ? "key" : ""}" style="top:${l.y}px">${l.label}</div>`;
  });
  (ax.breaks || []).forEach(b => { html += `<div class="brk" style="top:${b.y}px;height:${b.h}px">⋯ 省略 ${fmtDur(b.to - b.from)} ⋯</div>`; });
  if (ax.lines[0]?.center) html += `<div class="hline" style="top:${ax.total - 1}px"></div>`;
  html += `<div style="height:${ax.total}px"></div>`; // 佔 label 欄
  for (const d of ax.order) html += `<div class="col" data-day="${d}" style="height:${ax.total}px"></div>`;
  const body = $("#body");
  body.innerHTML = html;
  const cols = [...body.querySelectorAll(".col")];
  const colOf = {}; cols.forEach(col => { colOf[col.dataset.day] = col; });

  const items = ax.items.map(({ c, s }) => {
    const r = ax.yRange(s);
    return r && { c, s, top: r[0], bottom: r[1], lane: 0, lanes: 1 };
  }).filter(Boolean);

  // 同日重疊:並排
  for (const d of ax.order) {
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
  // 沒排行程的空檔自動標示「休息」
  if (state.opt.rest) {
    for (const d of ax.order) {
      const iv = items.filter(x => x.s.day === d).map(x => [x.top, x.bottom]).sort((p, q) => p[0] - q[0]);
      let pos = 0; const gaps = [];
      for (const [t, b] of iv) { if (t > pos) gaps.push([pos, t]); pos = Math.max(pos, b); }
      if (pos < ax.total) gaps.push([pos, ax.total]);
      for (const [t, b] of gaps) {
        if (b - t < 3) continue;
        const from = ax.yMin(t, false), to = ax.yMin(b, true);
        if (!(to > from)) continue;
        const pseudo = { id: "rest", name: "休息", room: "", note: "", slots: [{ day: d, from, to }] };
        let pieces = [[t, b]];
        for (const br of ax.breaks || []) pieces = pieces.flatMap(([p, q]) => (br.y >= q || br.y + br.h <= p) ? [[p, q]] : [[p, br.y], [br.y + br.h, q]].filter(([u, v]) => v - u > 0));
        for (const [pt, pb] of pieces) {
          const r = document.createElement("div");
          r.className = "course rest" + (off.has(d) ? " off" : "");
          const rh = Math.max(2, pb - pt - 2);
          r.style.cssText = `top:${pt + 1}px;height:${rh}px;left:2px;width:calc(100% - 4px)`;
          if (rh < 22) r.classList.add("tiny");
          r.innerHTML = rh >= 26 ? "<b>休息</b>" : ""; // 太小的格子不寫字,功能照舊(長按看詳情、點一下新增)
          bindPress(r, () => openCourse(null, { day: d, from, to: Math.min(to, from + 60) }), () => showInfo(pseudo, null, true));
          colOf[d].appendChild(r);
        }
      }
    }
  }
  for (const it of items) {
    const h = it.bottom - it.top - 4;
    const color = it.c.color || PALETTE[0];
    const el = document.createElement("div");
    el.className = "course" + (it.lanes > 1 ? " conflict" : "") + (off.has(it.s.day) ? " off" : "") + (isGhost(it.c, it.s) ? " ghost" : "");
    el.style.cssText = `top:${it.top + 2}px;height:${h}px;left:calc(${(it.lane / it.lanes) * 100}% + 2px);width:calc(${100 / it.lanes}% - 4px);background:${color};border-color:${shade(color, -0.35)}`;
    const room = it.s.room || it.c.room;
    el.innerHTML = `<b>${esc(it.c.name)}</b>${room ? `<small>${esc(room)}</small>` : ""}`;
    // 短按看詳情,長按編輯
    bindPress(el, () => isLocked(it.c.semester) ? showInfo(it.c, it.s) : openCourse(it.c), () => showInfo(it.c, it.s));
    colOf[it.s.day].appendChild(el);
  }
  // 點空白新增
  cols.forEach(col => {
    col.onclick = e => {
      const [from, to] = ax.toTime(e.clientY - col.getBoundingClientRect().top);
      openCourse(null, { day: +col.dataset.day, from, to });
    };
  });
}

// ---------- 日期簿(分頁)管理:複製 / 清除 ----------
let sheetSem = null;
function openSheet(sem) {
  sheetSem = sem;
  const n = state.courses.filter(c => c.semester === sem).length;
  $("#sheetName").textContent = sem;
  $("#sheetCount").textContent = n ? `共 ${n} 個行程` : "目前沒有行程";
  $("#btnSheetClear").disabled = !n || isLocked(sem);
  $("#btnSheetLock").textContent = isLocked(sem) ? "🔓 解除鎖定" : "🔒 鎖定日期簿";
  $("#btnSheetCopy").disabled = !n;
  $("#sheetDlg").showModal();
}
$("#btnSheetLock").onclick = () => {
  const s = new Set(state.opt.locked || []);
  const was = s.has(sheetSem);
  if (was) s.delete(sheetSem); else s.add(sheetSem);
  state.opt.locked = [...s];
  persistMeta(); renderAll(); openSheet(sheetSem);
  toast(was ? "已解除鎖定" : "已鎖定,不能再新增、修改或清除");
};
$("#btnSheetClose").onclick = () => $("#sheetDlg").close();
$("#sheetDlg").onclick = e => { if (e.target === e.currentTarget) e.currentTarget.close(); };
$("#btnSheetCopy").onclick = async () => {
  const src = sheetSem;
  const name = (prompt(`把「${src}」複製成新的日期簿,名稱:`, src + " 複本") || "").trim();
  if (!name) return;
  if (state.courses.some(c => c.semester === name)) return toast("已經有同名的日期簿");
  const copies = state.courses.filter(c => c.semester === src)
    .map(c => ({ ...c, id: uid(), semester: name, slots: c.slots.map(s => ({ ...s })) }));
  $("#sheetDlg").close();
  state.courses.push(...copies);
  state.semester = name;
  if (!state.semesters.includes(name)) state.semesters.unshift(name);
  persistMeta(); renderAll(); toast(`已複製到「${name}」`);
  try { await store.upsertMany(copies); }
  catch (err) { toast("複製失敗:" + err.message); await reload(); }
};
$("#btnSheetClear").onclick = async () => {
  const sem = sheetSem;
  if (isLocked(sem)) return toast("已鎖定,先解除鎖定");
  const n = state.courses.filter(c => c.semester === sem).length;
  if (!confirm(`清除「${sem}」的全部 ${n} 個行程?`)) return;
  if (!confirm(`再確認一次:真的要清除「${sem}」的所有行程嗎?\n這個動作無法復原。`)) return;
  $("#sheetDlg").close();
  state.courses = state.courses.filter(c => c.semester !== sem);
  if (sem !== state.semester) state.semesters = state.semesters.filter(s => s !== sem);
  persistMeta(); renderAll(); toast(`已清除「${sem}」`);
  try { await store.removeSemester(sem); }
  catch (err) { toast("清除失敗:" + err.message); await reload(); }
};

// ---------- 長按看詳情 ----------
function bindPress(el, onLong, onTap) {
  let timer = null, fired = false, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.onpointerdown = e => {
    fired = false; x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { fired = true; timer = null; navigator.vibrate?.(15); onLong(); }, 450);
  };
  el.onpointermove = e => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cancel(); };
  el.onpointerup = el.onpointerleave = el.onpointercancel = cancel;
  el.oncontextmenu = e => e.preventDefault();
  el.onclick = e => { e.stopPropagation(); if (fired) { fired = false; return; } onTap(); };
}
// 單節課隱形(例如這一節停課/請假):只淡化那一個時段,不影響同一門課的其他時段
const slotKey = (c, s) => `${c.id}|${s.day}|${s.from}|${s.to}`;
const isGhost = (c, s) => (state.opt.ghost || []).includes(slotKey(c, s));
function showInfo(c, slot, rest) {
  $("#infoRoom").hidden = !!rest; $("#infoRoom").previousElementSibling.hidden = !!rest;
  $("#btnInfoEdit").hidden = !!rest;
  $("#infoName").textContent = c.name;
  $("#infoRoom").textContent = c.room || "—";
  $("#infoNoteBox").hidden = !c.note;
  $("#infoNote").textContent = c.note || "";
  $("#infoTimes").innerHTML = c.slots.slice().sort((p, q) => p.day - q.day || p.from - q.from)
    .map(s => `<li>週${DAYS[s.day]} ${fmt(s.from)}–${fmt(s.to)}${s.room && s.room !== c.room ? ` <span class="muted">· ${esc(s.room)}</span>` : ""}</li>`).join("");
  $("#infoTotal").textContent = fmtDur(c.slots.reduce((t, s) => t + Math.max(0, s.to - s.from), 0));
  $("#btnInfoEdit").onclick = () => { $("#infoDlg").close(); openCourse(c); };
  const gb = $("#btnInfoGhost");
  gb.hidden = !slot;
  if (slot) {
    gb.textContent = isGhost(c, slot) ? "取消隱形" : "隱形這一節";
    gb.onclick = () => {
      const k = slotKey(c, slot), set = new Set(state.opt.ghost || []);
      const was = set.has(k);
      if (was) set.delete(k); else set.add(k);
      state.opt.ghost = [...set];
      persistMeta(); $("#infoDlg").close(); renderMain();
      toast(was ? "已恢復這一節" : "這一節已隱形,點方塊在詳情裡可取消");
    };
  }
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
      <button type="button" class="rm" title="移除">✕</button>${roomInput}`;
    const sSel = div.querySelector(".s"), eSel = div.querySelector(".e");
    sSel.onchange = () => { if (+eSel.value < +sSel.value) eSel.value = sSel.value; };
    eSel.onchange = () => { if (+eSel.value < +sSel.value) sSel.value = eSel.value; };
  } else {
    div.innerHTML = `<select class="d">${dayOpts(s.day)}</select>
      <input class="from" type="text" inputmode="numeric" autocomplete="off" placeholder="開始 0830" maxlength="6" value="${fmt(s.from)}" required>
      <input class="to" type="text" inputmode="numeric" autocomplete="off" placeholder="結束 0930" maxlength="6" value="${fmt(s.to)}" required>
      <button type="button" class="rm" title="移除">✕</button>${roomInput}
      <div class="durs"><span>時長</span>${[[50, "50 分"], [60, "1 小時"], [90, "1.5 小時"], [120, "2 小時"], [180, "3 小時"]].map(([m, l]) => `<button type="button" class="dur" data-m="${m}">${l}</button>`).join("")}</div>`;
    const f = div.querySelector(".from"), t = div.querySelector(".to");
    const norm = el => { const v = parseTimeInput(el.value); el.classList.toggle("bad", Number.isNaN(v)); if (!Number.isNaN(v)) el.value = fmt(v); return v; };
    let dur = Math.max(10, s.to - s.from);
    f.onfocus = t.onfocus = e => e.target.select();
    f.onchange = () => { const v = norm(f); if (!Number.isNaN(v)) { t.value = fmt(Math.min(1440, v + dur)); t.classList.remove("bad"); } };
    t.onchange = () => { const v = norm(t), fv = parseTimeInput(f.value); if (!Number.isNaN(v) && !Number.isNaN(fv) && v > fv) dur = v - fv; };
    div.querySelectorAll(".dur").forEach(b => { b.onclick = () => { const fv = parseTimeInput(f.value); if (Number.isNaN(fv)) return toast("先輸入開始時間"); dur = +b.dataset.m; t.value = fmt(Math.min(1440, fv + dur)); t.classList.remove("bad"); }; });
  }
  div.querySelector(".rm").onclick = () => div.remove();
  $("#slots").appendChild(div);
}
function readSlot(r) {
  const day = +r.querySelector(".d").value;
  const room = r.querySelector(".room").value.trim() || undefined;
  if (state.opt.period) {
    return { day, from: PERIODS[+r.querySelector(".s").value].s, to: PERIODS[+r.querySelector(".e").value].e, room };
  }
  return { day, from: parseTimeInput(r.querySelector(".from").value), to: parseTimeInput(r.querySelector(".to").value), room };
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

const isLocked = s => (state.opt.locked || []).includes(s);
function openCourse(c, preset) {
  if (isLocked(c?.semester || state.semester)) {
    if (c) showInfo(c); else toast("這個日期簿已鎖定,先解除鎖定才能新增");
    return;
  }
  editing = c;
  $("#dlgTitle").textContent = c ? "編輯名稱" : "新增名稱";
  form.name.value = c?.name || "";
  form.room.value = c?.room || "";
  form.note.value = c?.note || "";
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
$("#btnAdd").onclick = () => openCourse(null, { day: dayOfDate(state.anchor), from: 480, to: 540 });
$("#btnCancel").onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  const slots = [...document.querySelectorAll("#slots .slot")].map(readSlot);
  if (!slots.length) return toast("至少要有一個上課時段");
  if (slots.some(s => Number.isNaN(s.from) || Number.isNaN(s.to))) return toast("時間格式不對,請輸入像 0830 或 8:30");
  if (slots.some(s => !(s.to > s.from))) return toast("結束時間要晚於開始時間");
  const course = {
    id: editing?.id || uid(),
    semester: editing?.semester || state.semester,
    name: form.name.value.trim(),
    room: form.room.value.trim(),
    note: form.note.value.trim(),
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
$("#btnSem").onclick = () => {
  const s = prompt("新增時間表(例如 2026/11)", "");
  if (!s || !s.trim()) return;
  state.semester = s.trim();
  if (!state.semesters.includes(state.semester)) state.semesters.unshift(state.semester);
  persistMeta(); renderAll();
};
$("#btnSettings").onclick = () => {
  $("#optWeekend").checked = state.opt.weekend;
  $("#optSunFirst").checked = state.opt.sunFirst;
  $("#btnRest").textContent = `休息時段:${state.opt.rest ? "開" : "關"}`;
  $("#optNight").checked = state.opt.night;
  $("#optPeriod").checked = state.opt.period;
  $("#optKeys").value = state.opt.keys;
  renderAccount();
  renderInstall();
  $("#setDlg").showModal();
};
$("#btnRest").onclick = () => { state.opt.rest = !state.opt.rest; $("#btnRest").textContent = `休息時段:${state.opt.rest ? "開" : "關"}`; };
$("#setDlg").onclose = () => {
  state.opt.weekend = $("#optWeekend").checked;
  state.opt.sunFirst = $("#optSunFirst").checked;
  state.opt.night = $("#optNight").checked;
  state.opt.period = $("#optPeriod").checked;
  state.opt.keys = $("#optKeys").value;
  persistMeta(); renderMain();
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
    if (loc.length && confirm(`偵測到本機有 ${loc.length} 個離線行程,要上傳到你的帳號嗎?`)) {
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

// ---------- 新手教學 ----------
const TUT = [
  { t: "歡迎使用行程表 👋", d: "點空白格或右下角的 ＋ 就能新增行程(左上角 ☰ 可以切換行事曆),點方塊看詳情,長按方塊才是編輯。一個行程可以有多個時段,例如週二和週四都有。" },
  { t: "短按看詳情、長按編輯", d: "點一下行程方塊,會顯示完整的名稱、地點、所有上課時間和備註。按住約半秒才會進入編輯。詳情視窗裡也有「編輯」按鈕。" },
  { t: "常用詞", d: "在「名稱」「地點」輸入條下面按 ＋,可以把目前輸入的字存成常用詞。之後點一下標籤就自動填入,按 ✕ 可移除。" },
  { t: "補假 / 停課", d: "點上方的星期標題(一、二、三…),那一天的行程會整天變半透明;再點一次就恢復。" },
];
let tutI = 0;
const TUT_KEY = "tt.tutorial.hide";
function renderTut() {
  const p = TUT[tutI], last = tutI === TUT.length - 1;
  $("#tutTitle").textContent = p.t;
  $("#tutBody").textContent = p.d;
  $("#tutDots").innerHTML = TUT.map((_, i) => `<i class="${i === tutI ? "on" : ""}"></i>`).join("");
  $("#btnTutPrev").style.visibility = tutI ? "visible" : "hidden";
  $("#btnTutNext").textContent = last ? "完成" : "下一頁";
}
function openTutorial() { tutI = 0; renderTut(); $("#tutHide").checked = localStorage.getItem(TUT_KEY) === "1"; $("#tutDlg").showModal(); }
$("#btnTutPrev").onclick = () => { tutI = Math.max(0, tutI - 1); renderTut(); };
$("#btnTutNext").onclick = () => { if (tutI < TUT.length - 1) { tutI++; renderTut(); } else $("#tutDlg").close(); };
$("#btnTutSkip").onclick = () => $("#tutDlg").close();
$("#tutDlg").onclose = () => {
  try { localStorage.setItem(TUT_KEY, $("#tutHide").checked ? "1" : "0"); } catch {}
};
$("#btnTutorial").onclick = () => { $("#setDlg").close(); openTutorial(); };
if (localStorage.getItem(TUT_KEY) !== "1") setTimeout(openTutorial, 500);

// ---------- 公告 / 待辦事項 ----------
const TODO_KEY = "tt.todos";
const todos = () => { try { return JSON.parse(localStorage.getItem(TODO_KEY) || "[]"); } catch { return []; } };
const saveTodos = list => { localStorage.setItem(TODO_KEY, JSON.stringify(list)); renderTodoBadge(); };
const fmtDue = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const LEADS = [[0, "準時"], [10, "提前 10 分鐘"], [30, "提前 30 分鐘"], [60, "提前 1 小時"], [1440, "提前 1 天"]];

function renderTodoBadge() {
  const n = todos().filter(t => !t.done).length, b = $("#todoBadge");
  b.hidden = !n; b.textContent = n > 9 ? "9+" : n;
}
function renderTodos() {
  const list = todos().sort((p, q) => (p.done - q.done) || ((p.due ? new Date(p.due) : 8e15) - (q.due ? new Date(q.due) : 8e15)));
  const now = Date.now();
  $("#todoList").innerHTML = list.length ? list.map(t => {
    const late = t.due && !t.done && new Date(t.due).getTime() < now;
    return `<li class="${t.done ? "done" : ""}" data-id="${t.id}"><input type="checkbox" ${t.done ? "checked" : ""} aria-label="完成"><span class="tx">${esc(t.text)}${t.due ? `<small class="${late ? "late" : ""}">${late ? "已逾時 · " : ""}${fmtDue(t.due)}</small>` : ""}</span><button type="button" class="del" title="刪除">✕</button></li>`;
  }).join("") : '<li class="empty">還沒有待辦事項</li>';
  $("#todoList").querySelectorAll("li[data-id]").forEach(li => {
    li.querySelector("input").onchange = e => { const a2 = todos(), t = a2.find(x => x.id === li.dataset.id); if (t) { t.done = e.target.checked; saveTodos(a2); renderTodos(); } };
    li.querySelector(".del").onclick = () => { saveTodos(todos().filter(x => x.id !== li.dataset.id)); renderTodos(); };
  });
}
function renderNotifyPrefs() {
  $("#todoNotifyOn").checked = !!state.opt.notifyOn;
  $("#todoLead").innerHTML = LEADS.map(([m, l]) => `<option value="${m}" ${m === +state.opt.notifyLead ? "selected" : ""}>${l}</option>`).join("");
  $("#todoLead").disabled = !state.opt.notifyOn;
  let note = "到期時間留空的待辦不會通知。通知只會在網頁開著(或已安裝的 App 在背景執行)時送出。";
  if (!("Notification" in window)) note = "這個瀏覽器不支援系統通知,時間到會改用畫面上的提示。" ;
  else if (Notification.permission === "denied") note = "瀏覽器已封鎖通知權限,請到網站設定允許通知;目前只會用畫面提示。";
  $("#todoNote").textContent = note;
}
$("#btnTodo").onclick = () => { renderTodos(); renderNotifyPrefs(); $("#todoDlg").showModal(); };
$("#btnTodoClose").onclick = () => $("#todoDlg").close();
$("#todoForm").onsubmit = e => {
  e.preventDefault();
  const text = $("#todoText").value.trim();
  if (!text) return;
  const list = todos();
  list.push({ id: uid(), text, due: $("#todoDue").value || "", done: false, notified: false });
  saveTodos(list);
  $("#todoText").value = ""; $("#todoDue").value = "";
  renderTodos(); checkNotify();
};
$("#todoNotifyOn").onchange = async e => {
  state.opt.notifyOn = e.target.checked;
  if (state.opt.notifyOn && "Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch {}
  }
  persistMeta(); renderNotifyPrefs(); checkNotify();
};
$("#todoLead").onchange = e => {
  state.opt.notifyLead = +e.target.value; persistMeta();
  saveTodos(todos().map(t => ({ ...t, notified: t.done ? t.notified : false })));
  checkNotify();
};

async function fireNotify(t, late) {
  const body = `${t.text}${t.due ? " · " + fmtDue(t.due) : ""}`;
  const title = late ? "待辦事項(已逾時)" : "待辦事項提醒";
  toast("⏰ " + body);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) return void reg.showNotification(title, { body, icon: "icons/icon-192.png", tag: "todo-" + t.id });
    new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch {}
}
function checkNotify() {
  if (!state.opt.notifyOn) return;
  const now = Date.now(), list = todos(); let changed = false;
  for (const t of list) {
    if (t.done || !t.due || t.notified) continue;
    const due = new Date(t.due).getTime();
    if (Number.isNaN(due) || now < due - state.opt.notifyLead * 60000) continue;
    t.notified = true; changed = true;
    fireNotify(t, now > due);
  }
  if (changed) { saveTodos(list); if ($("#todoDlg").open) renderTodos(); }
}
setInterval(checkNotify, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNotify(); });
renderTodoBadge(); checkNotify();
