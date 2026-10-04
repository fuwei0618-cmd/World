/* World — 旅行 App 主程式 */
(function () {
"use strict";
const P = window.PRESETS;
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app"), tabsEl = $("#tabs");
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const ls = {
  get(k, d) { try { const v = localStorage.getItem("world:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem("world:" + k); else localStorage.setItem("world:" + k, JSON.stringify(v)); } catch (e) {} }
};
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayISO = () => isoOf(new Date());
const nowHM = () => { const n = new Date(); return pad(n.getHours()) + ":" + pad(n.getMinutes()); };
function md(iso) { const d = new Date(iso + "T00:00:00"); return { m: d.getMonth() + 1, d: d.getDate(), w: WD[d.getDay()], obj: d, y: d.getFullYear() }; }
function addDays(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d); }
function dayCount(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5) + 1; }
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2400); }
async function copyText(txt, el) {
  try { await navigator.clipboard.writeText(txt); toast("已複製"); }
  catch (e) { if (el && el.select) { el.focus(); el.select(); } toast("請長按選取後複製"); }
}
const country = t => P.countries[t && t.country] || P.countries.OTHER;

/* ================= storage ================= */
const DB = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open("world", 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore("trips", { keyPath: "id" });
          db.createObjectStore("notes", { keyPath: "id" }).createIndex("tripId", "tripId");
        };
        r.onsuccess = () => { DB.db = r.result; res(true); };
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      if (!DB.db) return rej(new Error("這個瀏覽器無法存資料"));
      const tx = DB.db.transaction(store, mode); const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error);
    });
  },
  allTrips() { return DB.db ? DB.req("trips", "readonly", s => s.getAll()) : Promise.resolve([]); },
  putTrip(t) { t.updatedAt = Date.now(); return DB.req("trips", "readwrite", s => s.put(t)); },
  delTrip(id) { return DB.req("trips", "readwrite", s => s.delete(id)); },
  notes(tripId) { return DB.db ? DB.req("notes", "readonly", s => s.index("tripId").getAll(tripId)) : Promise.resolve([]); },
  allNotes() { return DB.db ? DB.req("notes", "readonly", s => s.getAll()) : Promise.resolve([]); },
  putNote(n) { return DB.req("notes", "readwrite", s => s.put(n)); },
  delNote(id) { return DB.req("notes", "readwrite", s => s.delete(id)); }
};

/* ================= state & routing ================= */
const params = new URLSearchParams(location.search);
const VIEWER_ID = params.get("t");
const state = {
  viewer: !!VIEWER_ID,
  trips: [], allNotes: [],
  trip: null, notes: [],
  view: "home", homeTab: "trips", tab: "overview", day: 0, dayMode: "plan",
  showCancelled: true, unlocked: null
};
const isOwner = () => !state.viewer;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  if (h[0] === "trip" && h[1]) {
    state.view = "trip"; state.tripId = decodeURIComponent(h[1]);
    state.tab = h[2] || "overview";
    if (h[2] === "day") { state.day = Number(h[3]) || 0; state.dayMode = h[4] === "record" ? "record" : "plan"; }
  } else { state.view = "home"; state.homeTab = h[1] || "trips"; }
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function tripHash(tab, day, mode) {
  const id = encodeURIComponent(state.trip.id);
  if (tab === "day") return `#/trip/${id}/day/${day ?? state.day}/${mode || state.dayMode}`;
  return `#/trip/${id}/${tab}`;
}

/* ================= trip model helpers ================= */
function sortItems(items) {
  return items.map((it, i) => [it, i]).sort((a, b) => {
    const ta = a[0].time || "99:99", tb = b[0].time || "99:99";
    return ta < tb ? -1 : ta > tb ? 1 : a[1] - b[1];
  }).map(x => x[0]);
}
function newTrip({ title, countryCode, cities, start, end }) {
  const c = P.countries[countryCode] || P.countries.OTHER;
  const n = Math.max(1, dayCount(start, end));
  const days = [];
  for (let i = 0; i < n; i++) days.push(newDay(addDays(start, i)));
  days[0].title = "出發日"; days[0].type = "transit";
  days[0].items = [
    { id: uid("i"), time: "", title: "出發", status: "plan" },
    { id: uid("i"), time: "", title: "抵達機場、報到", status: "plan" },
    { id: uid("i"), time: "", title: "航班起飛", status: "plan" },
    { id: uid("i"), time: "", title: "落地入境", status: "plan" },
    { id: uid("i"), time: "", title: "入住飯店", status: "plan" }
  ];
  if (n > 1) {
    const L = days[n - 1]; L.title = "回程日"; L.type = "transit";
    L.items = [
      { id: uid("i"), time: "", title: "退房", status: "plan" },
      { id: uid("i"), time: "", title: "前往機場", status: "plan" },
      { id: uid("i"), time: "", title: "航班起飛", status: "plan" },
      { id: uid("i"), time: "", title: "抵達、回家", status: "plan" }
    ];
  }
  const packing = clone(P.packingBase).map(g => ({ group: g.group, items: g.items.map(t => ({ t, ok: false })) }));
  if (c.packingExtra.length) packing[0].items.push(...c.packingExtra.map(t => ({ t, ok: false })));
  return {
    id: uid("trip-"), title, subtitle: "", country: countryCode, cities,
    start, end, highlights: [], team: null, days, packing,
    apps: clone(c.apps), food: { eat: [], buy: [] },
    flights: [], hotels: [], emergency: clone(c.emergency), hospital: "", lostPlan: "",
    private: { contacts: [], insurance: { co: "", tel: "", policy: "", note: "" }, memo: "" },
    createdAt: Date.now()
  };
}
function newDay(date) {
  return { id: uid("d"), date, title: "", type: "free", stay: "", notice: { meet: "", dress: "", bring: "", notes: "", meal: "" }, items: [] };
}
function tripStatus(t) {
  const today = todayISO();
  if (today < t.start) return "upcoming";
  if (today > t.end) return "past";
  return "now";
}
function todayIndex(t) { return t.days.findIndex(d => d.date === todayISO()); }
async function saveTrip() {
  if (!isOwner()) return;
  await DB.putTrip(state.trip);
  const i = state.trips.findIndex(t => t.id === state.trip.id);
  if (i >= 0) state.trips[i] = state.trip; else state.trips.push(state.trip);
}

/* ================= map links & app links ================= */
function mapURL(t, it) {
  const c = country(t);
  const name = it.place || it.title || "";
  const city = (t.cities || [])[0] || "";
  const hasLL = typeof it.lat === "number" && typeof it.lng === "number";
  if (c.map === "amap") {
    return hasLL
      ? `https://uri.amap.com/marker?position=${it.lng},${it.lat}&name=${encodeURIComponent(name)}&coordinate=wgs84&callnative=1`
      : `https://uri.amap.com/search?keyword=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}&callnative=1`;
  }
  if (c.map === "naver") return `https://map.naver.com/p/search/${encodeURIComponent(hasLL ? it.lat + "," + it.lng : name + " " + city)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasLL ? it.lat + "," + it.lng : name + " " + city)}`;
}
const mapLabel = t => ({ amap: "高德地圖", naver: "NAVER 地圖" }[country(t).map] || "Google 地圖");
function appURL(a) { return a.url || "itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=" + encodeURIComponent(a.n); }

/* ================= object URLs ================= */
const urls = [];
function blobURL(b) { if (!b) return ""; const u = URL.createObjectURL(b); urls.push(u); return u; }
function freeURLs() { while (urls.length) URL.revokeObjectURL(urls.pop()); }

/* ================= render: shared bits ================= */
function typeChip(t) { return `<span class="chip type t-${t}">${esc(P.types[t] || t)}</span>`; }
const ICON = {
  back: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>`,
  more: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`
};
function tabBar(list, cur) {
  tabsEl.innerHTML = list.map(t => t.rec
    ? `<button class="rec" data-tab="${t.k}" aria-label="${t.l}"><span class="dot">${t.svg}</span>${t.l}</button>`
    : `<button data-tab="${t.k}" aria-current="${t.k === cur}">${t.svg}${t.l}</button>`).join("");
}
const SV = {
  trips: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3"/></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  time: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
  day: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  prep: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 7V4h6v3M9 12l2 2 4-4"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 16l20-6-2-3-7 2-6-5-2 1 4 6-5 2-2-1-1 1z"/></svg>`
};

/* ================= HOME ================= */
function coverFor(tripId) {
  const n = state.allNotes.find(n => n.tripId === tripId && (n.media || []).some(m => m.kind === "photo"));
  return n ? n.media.find(m => m.kind === "photo").blob : null;
}
function tripCard(t) {
  const s = md(t.start), e = md(t.end), st = tripStatus(t), c = country(t);
  const diff = Math.round((s.obj - new Date(todayISO() + "T00:00:00")) / 864e5);
  const badge = st === "now" ? `<span class="chip type t-city">旅途中</span>` : st === "upcoming" ? `<span class="chip">${diff} 天後</span>` : "";
  const cov = coverFor(t.id);
  return `<button class="tripcard" data-open="${esc(t.id)}">
    <div class="cover">${cov ? `<img src="${blobURL(cov)}" alt="">` : c.flag}</div>
    <div style="min-width:0"><div class="row" style="justify-content:space-between"><h3>${esc(t.title)}</h3>${badge}</div>
    <div class="sub mono">${s.y}.${pad(s.m)}.${pad(s.d)} – ${pad(e.m)}.${pad(e.d)}・${dayCount(t.start, t.end)} 天</div>
    <div class="sub">${c.flag} ${esc((t.cities || []).join("、") || c.name)}</div></div></button>`;
}
function viewHomeTrips() {
  const T = [...state.trips].sort((a, b) => a.start < b.start ? -1 : 1);
  const now = T.filter(t => tripStatus(t) === "now"), up = T.filter(t => tripStatus(t) === "upcoming"), past = T.filter(t => tripStatus(t) === "past").reverse();
  const sec = (title, list) => list.length ? `<section class="section"><header><h2>${title}</h2><span class="muted">${list.length}</span></header><div class="stack">${list.map(tripCard).join("")}</div></section>` : "";
  return `${!T.length ? `<div class="card empty" style="margin-top:12px"><b>開始第一趟旅行</b>按「新增旅行」，選國家和日期，模板會幫你排好骨架。<div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="newtrip">＋ 新增旅行</button><button class="btn ghost" data-act="sample">載入重慶範例</button></div></div>` :
    `<button class="btn primary wide" data-act="newtrip" style="margin-top:8px">＋ 新增旅行</button>`}
    ${sec("旅途中", now)}${sec("即將出發", up)}${sec("去過", past)}`;
}
function visitedStats() {
  const done = state.trips.filter(t => tripStatus(t) !== "upcoming");
  const cities = new Map(), countries = new Set();
  done.forEach(t => { countries.add(t.country); (t.cities || []).forEach(c => cities.set(c, country(t).flag)); });
  return { trips: done.length, countries: countries.size, cities };
}
function viewHomeMap() {
  const s = visitedStats();
  return `<div class="stats" style="margin-top:8px"><div class="stat"><b>${s.countries}</b><span>國家</span></div><div class="stat"><b>${s.cities.size}</b><span>城市</span></div><div class="stat"><b>${s.trips}</b><span>趟旅行</span></div></div>
  ${s.cities.size ? `<div class="row" style="margin-top:12px">${[...s.cities].map(([c, f]) => `<span class="chip">${f} ${esc(c)}</span>`).join("")}</div>` : ""}
  <div id="map" style="margin-top:12px" role="region" aria-label="足跡地圖"></div>
  <p class="hint" style="margin-top:8px">地圖上的點來自：行程裡有座標的地點，以及每則紀錄當下的定位。</p>
  <button class="btn ghost wide" data-act="kml" style="margin-top:10px">匯出到 Google 我的地圖（KML）</button>`;
}
function viewHomeTimeline() {
  const T = [...state.trips].sort((a, b) => a.start < b.start ? 1 : -1);
  if (!T.length) return `<div class="card empty" style="margin-top:12px"><b>還沒有旅行</b>新增第一趟旅行後，這裡會依年份排出你的旅行時間線。</div>`;
  const byYear = {};
  T.forEach(t => (byYear[t.start.slice(0, 4)] = byYear[t.start.slice(0, 4)] || []).push(t));
  return Object.keys(byYear).sort().reverse().map(y => `<section class="section"><div class="year">${y}</div><div class="tline">${byYear[y].map(t => {
    const cnt = state.allNotes.filter(n => n.tripId === t.id).length;
    return tripCard(t).replace("</div></button>", `<div class="sub">${cnt} 則紀錄</div></div></button>`);
  }).join("")}</div></section>`).join("");
}
function viewHome() {
  const sub = { trips: viewHomeTrips, map: viewHomeMap, timeline: viewHomeTimeline }[state.homeTab] || viewHomeTrips;
  tabBar([{ k: "home:trips", l: "旅行", svg: SV.trips }, { k: "home:map", l: "足跡", svg: SV.map }, { k: "home:timeline", l: "時間線", svg: SV.time }], "home:" + state.homeTab);
  return `<div class="topbar"><span class="brand">World</span><button class="icon-btn" data-act="settings" aria-label="設定">${ICON.gear}</button></div>${sub()}`;
}

/* ================= TRIP: overview ================= */
function tripTop(title, extra = "") {
  return `<div class="topbar">${isOwner() ? `<button class="icon-btn" data-nav="#/home/trips" aria-label="回旅行列表">${ICON.back}</button>` : ""}<span class="name">${esc(title)}</span>${extra}</div>`;
}
function viewOverview() {
  const t = state.trip, s = md(t.start), c = country(t);
  const n = dayCount(t.start, t.end), st = tripStatus(t);
  const diff = Math.round((s.obj - new Date(todayISO() + "T00:00:00")) / 864e5);
  const status = st === "upcoming" ? [diff, "天後出發"] : st === "now" ? ["D" + todayIndex(t), "旅途中"] : ["✓", "已完成"];
  const ti = todayIndex(t);
  return `${tripTop(t.title, isOwner() ? `<button class="icon-btn" data-act="tripmenu" aria-label="旅行選單">${ICON.more}</button>` : "")}
  <section class="ticket">
    <div class="eyebrow">${esc(t.subtitle || c.name)}</div>
    <h1>${esc(t.title)}</h1>
    <div class="route"><span>TPE</span><i></i><span>✈</span><i></i><span>${esc((t.cities || [])[0] || c.name)}</span></div>
    <div class="perf"></div>
    <div class="meta"><div><span>出發</span><b>${s.m}/${s.d}</b></div><div><span>天數</span><b>${n} 天</b></div><div><span>${status[1]}</span><b>${status[0]}</b></div></div>
    ${t.highlights.length ? `<ul>${t.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
  </section>
  ${isOwner() ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-act="edittrip">${ICON.pen} 編輯旅行資料</button><button class="btn sm primary" data-act="publish">發布給團員</button></div>` : ""}

  <section class="section"><header><h2>行程總覽</h2></header>
    <div class="row">${Object.keys(P.types).map(typeChip).join("")}</div>
    <div class="stack">${t.days.map((d, i) => { const x = md(d.date); const live = d.items.filter(it => !it.journalOnly && it.status !== "cancel");
      return `<button class="ov t-${d.type}${i === ti ? " today" : ""}" data-day="${i}"><div class="d">D${i}<small>${x.m}/${x.d}（${x.w}）</small></div>
      <div style="min-width:0"><h3>${esc(d.title || "（未命名）")}</h3>${live.length ? `<div class="r">${esc(live.map(it => it.title).join(" → "))}</div>` : `<div class="r">還沒有行程</div>`}${d.stay ? `<div class="r">🏨 ${esc(d.stay)}</div>` : ""}</div></button>`; }).join("")}</div>
  </section>

  ${t.team ? `<section class="section"><header><h2>相見歡</h2>${isOwner() ? `<button class="btn sm ghost" data-act="addmember">＋ 團員</button>` : ""}</header>
    <div class="card"><div class="eyebrow">團員與分工（${t.team.members.length} 人）</div><div class="members">${t.team.members.map((m, i) => `<button class="member" ${isOwner() ? `data-member="${i}"` : "disabled"}><b>${esc(m.name)}</b><small>${esc(m.role)}</small><small>${esc(m.duty)}</small></button>`).join("")}</div></div>
    ${t.team.note || t.team.oath.length ? `<details class="card"><summary>領隊真心話＆行前誓言</summary>${t.team.note ? `<p>${esc(t.team.note)}</p>` : ""}${t.team.oath.length ? `<ol style="margin:0;padding-left:20px">${t.team.oath.map(o => `<li>我發誓，${esc(o)}</li>`).join("")}</ol>` : ""}${isOwner() ? `<button class="btn sm" data-act="editteam" style="margin-top:10px">編輯</button>` : ""}</details>` : isOwner() ? `<button class="btn ghost" data-act="editteam">＋ 寫領隊真心話與行前誓言</button>` : ""}
  </section>` : isOwner() ? `<section class="section"><button class="btn ghost wide" data-act="addteam">＋ 這是團體旅行：加入團員分工</button></section>` : ""}`;
}

/* ================= TRIP: day ================= */
function itemHTML(it, opts) {
  const t = state.trip;
  const cls = ["item", it.status === "cancel" ? "cancel" : "", it.status === "done" ? "done" : "", it.journalOnly ? "point" : ""].join(" ");
  const repl = it.replacedBy ? state.trip.days[state.day].items.find(x => x.id === it.replacedBy) : null;
  const notes = opts.record ? state.notes.filter(n => n.itemId === it.id).sort((a, b) => a.ts - b.ts) : [];
  return `<div class="${cls}" id="it-${it.id}">
    <time>${esc(it.time || "－")}</time>
    <div style="min-width:0">
      <div class="t"><span>${esc(it.title)}${it.journalOnly ? ` <span class="chip">記錄點</span>` : ""}</span>${isOwner() ? `<button class="icon-btn" data-item="${it.id}" aria-label="項目選單" style="margin:-8px -6px 0 0">${ICON.more}</button>` : ""}</div>
      ${it.desc && !opts.record ? `<p class="desc">${esc(it.desc)}</p>` : ""}
      ${(it.place || it.dur || (it.tips || []).length || it.link) && !opts.record ? `<div class="meta">
        ${it.place || typeof it.lat === "number" ? `<a class="chip" href="${esc(mapURL(t, it))}" target="_blank" rel="noopener">${ICON.pin} ${esc(it.place || it.title)}</a>` : ""}
        ${it.dur ? `<span class="chip">${esc(it.dur)}</span>` : ""}
        ${(it.tips || []).map(x => `<span class="chip">${esc(x)}</span>`).join("")}
        ${it.link ? `<a class="chip" href="${esc(it.link)}" target="_blank" rel="noopener">▶ ${esc(it.linkTitle || "連結")}</a>` : ""}</div>` : ""}
      ${(it.niches || []).length && !opts.record ? `<div class="meta">${it.niches.map(n => { const k = it.id + ":" + n; const on = !!(ls.get("niche", {})[k]); return `<button class="chip" data-niche="${esc(k)}" aria-pressed="${on}" style="${on ? "background:var(--ok);color:#fff" : ""}">${esc(n)}</button>`; }).join("")}</div>` : ""}
      ${repl ? `<div class="replaced">改成 → ${esc(repl.time)} ${esc(repl.title)}</div>` : ""}
      ${opts.record ? `${notes.map(noteHTML).join("")}<div class="row" style="margin-top:8px"><button class="btn sm" data-rec="${it.id}">＋ 記錄</button></div>` : ""}
    </div></div>`;
}
function noteHTML(n) {
  const x = new Date(n.ts);
  const media = n.media || [];
  const vis = media.filter(m => m.kind !== "audio");
  return `<div class="rec-note"><div class="row" style="justify-content:space-between"><time>${pad(x.getHours())}:${pad(x.getMinutes())}${typeof n.lat === "number" ? " 📍" : ""}</time>
    ${isOwner() ? `<div class="row"><button class="btn sm ghost" data-editnote="${n.id}">編輯</button></div>` : ""}</div>
    ${vis.length ? `<div class="media">${vis.map((m, i) => m.kind === "photo"
      ? `<button class="pthumb" data-view="${n.id}:${media.indexOf(m)}"><img src="${blobURL(m.blob)}" alt="照片"></button>`
      : `<button class="vthumb" data-view="${n.id}:${media.indexOf(m)}" aria-label="播放影片"><video src="${blobURL(m.blob)}#t=0.1" muted playsinline preload="metadata"></video></button>`).join("")}</div>` : ""}
    ${n.text ? `<p>${esc(n.text)}</p>` : ""}
    ${media.filter(m => m.kind === "audio").map(m => `<audio controls preload="metadata" src="${blobURL(m.blob)}"></audio>`).join("")}
  </div>`;
}
function viewDay() {
  const t = state.trip;
  if (state.day >= t.days.length) state.day = 0;
  const d = t.days[state.day], x = md(d.date), N = d.notice;
  const rec = state.dayMode === "record" && isOwner();
  let items = sortItems(d.items);
  if (!rec) items = items.filter(it => !it.journalOnly && (state.showCancelled || it.status !== "cancel"));
  const loose = rec ? state.notes.filter(n => n.dayId === d.id && !d.items.some(it => it.id === n.itemId)) : [];
  const hasCancelled = d.items.some(it => it.status === "cancel" && !it.journalOnly);
  return `${tripTop(t.title)}
  <div class="daypick">${t.days.map((dd, i) => { const y = md(dd.date); return `<button data-day="${i}" aria-current="${i === state.day}"><b>D${i}</b><small>${y.m}/${y.d}</small></button>`; }).join("")}</div>
  ${isOwner() ? `<div class="seg" style="margin-top:4px"><button data-mode="plan" aria-pressed="${!rec}">行程</button><button data-mode="record" aria-pressed="${rec}">紀錄</button></div>` : ""}

  <section class="dayhead t-${d.type}" style="margin-top:16px">
    <div class="row" style="justify-content:space-between"><div class="row"><span class="eyebrow mono">D${state.day}・${x.m}/${x.d}（${x.w}）</span>${typeChip(d.type)}</div>${isOwner() ? `<button class="icon-btn" data-act="editday" aria-label="編輯這天">${ICON.pen}</button>` : ""}</div>
    <h1>${esc(d.title || "（未命名）")}</h1>
  </section>

  ${!rec ? `<section class="card stack" style="margin-top:14px">
    <dl class="kv">${[["集合", N.meet], ["穿搭", N.dress], ["要帶", N.bring], ["注意", N.notes], ["用餐", N.meal], ["住宿", d.stay]].filter(r => r[1]).map(r => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join("") || `<dt>提醒</dt><dd class="muted">${isOwner() ? "按右上角筆形圖示填集合時間、穿搭、要帶什麼" : "尚未填寫"}</dd>`}</dl>
    ${isOwner() ? `<button class="btn primary wide" data-act="line">產生這天的 LINE 通知（前一晚發）</button>` : ""}
  </section>` : `<p class="hint" style="margin-top:12px">每個時間點都能記錄。兩格之間按「插入記錄點」可以加臨時的點，只會出現在紀錄裡，不會動到行程。</p>`}

  <section class="section t-${d.type}">
    <header><h2>${rec ? "這天的紀錄" : "時間表"}</h2>${!rec && hasCancelled ? `<button class="btn sm ghost" data-act="togglecancel">${state.showCancelled ? "隱藏原計畫" : "顯示原計畫"}</button>` : ""}</header>
    <div class="card tl">
      ${rec ? `<div class="insert"><button data-insert="0">＋ 插入記錄點</button></div>` : ""}
      ${items.length ? items.map((it, i) => itemHTML(it, { record: rec }) + (rec ? `<div class="insert"><button data-insert="${i + 1}">＋ 插入記錄點</button></div>` : "")).join("") : `<div class="empty"><b>這天還沒有行程</b>${isOwner() ? "按下方「新增行程」開始排" : ""}</div>`}
    </div>
    ${isOwner() && !rec ? `<button class="btn ghost wide" data-act="additem">＋ 新增行程</button>` : ""}
    ${loose.length ? `<div class="card"><div class="eyebrow">其他紀錄</div>${loose.map(noteHTML).join("")}</div>` : ""}
  </section>`;
}

/* ================= TRIP: prep ================= */
function packState() {
  const t = state.trip;
  if (isOwner()) return { get: (g, i) => !!t.packing[g].items[i].ok };
  const m = ls.get("pack:" + t.id, {});
  return { get: (g, i) => !!m[g + "-" + i] };
}
function viewPrep() {
  const t = state.trip, ps = packState();
  let total = 0, done = 0;
  t.packing.forEach((g, gi) => g.items.forEach((_, ii) => { total++; if (ps.get(gi, ii)) done++; }));
  const groups = {};
  t.apps.forEach((a, i) => (groups[a.group || "其他"] = groups[a.group || "其他"] || []).push([a, i]));
  return `${tripTop("行前準備", `<span class="chip mono" id="packcount">${done}/${total}</span>`)}
  <div class="progress"><i id="packbar" style="width:${total ? done / total * 100 : 0}%"></i></div>
  <section class="section"><header><h2>行李清單</h2>${isOwner() ? `<button class="btn sm ghost" data-act="addgroup">＋ 分類</button>` : ""}</header>
    ${t.packing.map((g, gi) => `<div class="card"><div class="row" style="justify-content:space-between"><div class="eyebrow">${esc(g.group)}</div>${isOwner() ? `<button class="btn sm ghost" data-act="cleargroup" data-g="${gi}">全部取消勾選</button>` : ""}</div>
      ${g.items.map((it, ii) => `<label class="check"><input type="checkbox" id="pk-${gi}-${ii}" data-pack="${gi}-${ii}" ${ps.get(gi, ii) ? "checked" : ""}><span>${esc(it.t)}</span>${isOwner() ? `<button class="icon-btn" data-delpack="${gi}-${ii}" aria-label="刪除">×</button>` : ""}</label>`).join("")}
      ${isOwner() ? `<form class="addline" data-addpack="${gi}"><input id="ap-${gi}" placeholder="加一項…" aria-label="新增行李項目"><button class="btn sm">加入</button></form>` : ""}</div>`).join("")}
  </section>
  <section class="section"><header><h2>APP 與下載</h2>${isOwner() ? `<button class="btn sm ghost" data-act="addapp">＋ App</button>` : ""}</header>
    ${Object.keys(groups).map(g => `<div class="card"><div class="eyebrow">${esc(g)}</div>${groups[g].map(([a, i]) => `<div class="app"><div style="min-width:0"><b>${esc(a.n)}</b><small>${esc(a.d || "")}</small></div><div class="row" style="flex-wrap:nowrap"><a class="btn sm" href="${esc(appURL(a))}">下載</a>${isOwner() ? `<button class="icon-btn" data-app="${i}" aria-label="編輯">${ICON.pen}</button>` : ""}</div></div>`).join("")}</div>`).join("") || `<div class="card empty">還沒有 App</div>`}
    <p class="hint">「下載」會在 iPhone 上打開 App Store 搜尋該 App。也可以在編輯裡貼上 App Store 網址，直接開啟正確頁面。</p>
  </section>
  <section class="section"><header><h2>美食伴手</h2></header>
    <div class="card stack">${["eat", "buy"].map(k => `<div class="eyebrow">${k === "eat" ? "必吃" : "必買"}</div><div class="row">${t.food[k].map((f, i) => `<span class="chip ${isOwner() ? "x" : ""}">${esc(f)}${isOwner() ? `<button data-delfood="${k}:${i}" aria-label="刪除">×</button>` : ""}</span>`).join("") || `<span class="muted">—</span>`}</div>
      ${isOwner() ? `<form class="addline" data-addfood="${k}"><input id="af-${k}" placeholder="加一項…" aria-label="新增"><button class="btn sm">加入</button></form>` : ""}`).join("")}</div>
  </section>`;
}

/* ================= TRIP: info ================= */
function telRow(n, sub, num) { return `<div class="tel"><div class="n">${esc(n)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>${num ? `<div class="row" style="flex-wrap:nowrap"><span class="num">${esc(num)}</span><button class="btn sm" data-copy="${esc(num)}">複製</button></div>` : ""}</div>`; }
function privateData() { return isOwner() ? state.trip.private : state.unlocked; }
function viewInfo() {
  const t = state.trip, pv = privateData();
  const edit = (k, i) => isOwner() ? `<button class="icon-btn" data-rec-edit="${k}:${i}" aria-label="編輯">${ICON.pen}</button>` : "";
  return `${tripTop("機票・飯店・緊急")}
  <section class="section" style="margin-top:8px"><header><h2>航班</h2>${isOwner() ? `<button class="btn sm ghost" data-rec-add="flights">＋ 航班</button>` : ""}</header>
    ${t.flights.map((f, i) => `<div class="card"><div class="passhead"><span class="chip">${esc(f.dir)}${f.date ? "・" + esc(f.date) : ""}</span><div class="row"><b class="mono">${esc(f.no)}</b>${edit("flights", i)}</div></div>
      <div class="pass"><div><div class="tm">${esc(f.dep)}</div><div class="apt">${esc(f.from)}</div></div><div class="mid">✈</div><div><div class="tm">${esc(f.arr)}</div><div class="apt">${esc(f.to)}</div></div></div>
      ${f.note ? `<p class="hint" style="margin-top:8px;text-align:center">${esc(f.note)}</p>` : ""}</div>`).join("") || `<div class="card empty">還沒有航班</div>`}
  </section>
  <section class="section"><header><h2>飯店</h2>${isOwner() ? `<button class="btn sm ghost" data-rec-add="hotels">＋ 飯店</button>` : ""}</header>
    ${t.hotels.map((h, i) => `<div class="card"><div class="row" style="justify-content:space-between"><span class="chip mono">${esc(h.dates)}</span>${edit("hotels", i)}</div><h3 style="font-size:16px;margin-top:6px">${esc(h.name)}</h3>
      ${h.addr ? `<div class="muted" style="user-select:all">${esc(h.addr)}</div>` : ""}
      <div class="row" style="margin-top:8px">${h.addr ? `<a class="btn sm" href="${esc(mapURL(t, { place: h.addr }))}" target="_blank" rel="noopener">${ICON.pin} ${mapLabel(t)}</a><button class="btn sm" data-copy="${esc(h.addr)}">複製地址</button>` : ""}${h.tel ? `<button class="btn sm" data-copy="${esc(h.tel)}">複製電話 ${esc(h.tel)}</button>` : ""}</div></div>`).join("") || `<div class="card empty">還沒有飯店</div>`}
  </section>
  <section class="section"><header><h2>聯絡人與保險 🔒</h2>${isOwner() ? `<button class="btn sm ghost" data-rec-add="contacts">＋ 聯絡人</button>` : ""}</header>
    ${pv ? `<div class="card">${(pv.contacts || []).map((c, i) => `<div class="row" style="flex-wrap:nowrap"><div class="grow">${telRow(c.t, c.n, c.tel)}</div>${edit("contacts", i)}</div>`).join("") || `<p class="muted" style="margin:0">還沒有聯絡人（司機、導遊、包車…）</p>`}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><div class="eyebrow">旅遊保險</div>${isOwner() ? `<button class="icon-btn" data-act="editins" aria-label="編輯保險">${ICON.pen}</button>` : ""}</div>
        ${pv.insurance && (pv.insurance.co || pv.insurance.tel) ? telRow(pv.insurance.co, [pv.insurance.policy && "保單 " + pv.insurance.policy, pv.insurance.note].filter(Boolean).join("・"), pv.insurance.tel) : `<p class="muted" style="margin:0">未填</p>`}</div>
      ${isOwner() ? `<p class="hint">這一區發布時會用團員密碼加密，沒有密碼的人看不到。</p>` : ""}`
    : `<div class="card lock stack"><b>這區需要團員密碼</b><p class="hint">司機、導遊、保險等聯絡資訊，請向領隊索取密碼。</p>
      <form class="addline" data-unlock><input id="unlockpw" type="password" placeholder="團員密碼" aria-label="團員密碼" autocomplete="off"><button class="btn sm primary">解鎖</button></form></div>`}
  </section>
  <section class="section"><header><h2>緊急應變</h2>${isOwner() ? `<button class="btn sm ghost" data-rec-add="emergency">＋ 電話</button>` : ""}</header>
    <div class="card">${t.emergency.map((e, i) => `<div class="row" style="flex-wrap:nowrap"><div class="grow">${telRow(e.n, "", e.tel)}</div>${edit("emergency", i)}</div>`).join("")}</div>
    ${t.hospital || t.lostPlan || isOwner() ? `<div class="card stack"><div class="row" style="justify-content:space-between"><div class="eyebrow">就近醫院・防走丟</div>${isOwner() ? `<button class="icon-btn" data-act="editsafety" aria-label="編輯">${ICON.pen}</button>` : ""}</div>
      <div>${esc(t.hospital || "—")}</div><div class="muted">${esc(t.lostPlan || "")}</div></div>` : ""}
  </section>`;
}

/* ================= render ================= */
let mapInst = null;
function render() {
  freeURLs();
  if (mapInst) { try { mapInst.remove(); } catch (e) {} mapInst = null; }
  if (state.view === "home" && !state.viewer) {
    app.innerHTML = viewHome();
    if (state.homeTab === "map") mountMap();
  } else {
    if (!state.trip) { app.innerHTML = `<div class="card empty" style="margin-top:24px"><b>找不到這趟旅行</b>${isOwner() ? `<a href="#/home/trips">回旅行列表</a>` : "請確認網址是否正確"}</div>`; tabsEl.innerHTML = ""; return; }
    const v = { overview: viewOverview, day: viewDay, prep: viewPrep, info: viewInfo }[state.tab] || viewOverview;
    app.innerHTML = v();
    const list = [{ k: "overview", l: "總覽", svg: SV.home }, { k: "day", l: "每日", svg: SV.day }];
    if (isOwner()) list.push({ k: "rec", l: "記錄", svg: SV.mic, rec: true });
    list.push({ k: "prep", l: "準備", svg: SV.prep }, { k: "info", l: "資訊", svg: SV.info });
    tabBar(list, state.tab);
    if (state.tab === "day") { const c = app.querySelector('.daypick [aria-current="true"]'); if (c) c.scrollIntoView({ inline: "center", block: "nearest" }); }
  }
}
async function route() {
  parseHash();
  if (state.view === "trip" && isOwner()) {
    const t = state.trips.find(x => x.id === state.tripId);
    if (!state.trip || state.trip.id !== state.tripId) { state.trip = t || null; state.notes = t ? await DB.notes(t.id) : []; }
  }
  render();
  window.scrollTo(0, 0);
}

/* ================= sheets & forms ================= */
function sheet(html, onClose) {
  const sc = document.createElement("div"); sc.className = "scrim";
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}<button class="btn ghost" data-close>關閉</button></div>`;
  document.body.appendChild(sc);
  const close = () => { if (onClose) onClose(); sc.remove(); };
  sc.addEventListener("click", e => { if (e.target === sc || e.target.closest("[data-close]")) close(); });
  sc._close = close;
  return sc;
}
/* fields: {k,l,type,options,ph,full} ; type lines = array as newline text */
function formSheet({ title, fields, value, onSave, onDelete, extraHTML, onMount }) {
  const v = value || {};
  const f = fields.map(fd => {
    const id = "f-" + fd.k;
    let val = v[fd.k]; if (fd.type === "lines") val = (val || []).join("\n");
    let input;
    if (fd.type === "textarea" || fd.type === "lines") input = `<textarea id="${id}" placeholder="${esc(fd.ph || "")}">${esc(val)}</textarea>`;
    else if (fd.type === "select") input = `<select id="${id}">${fd.options.map(o => `<option value="${esc(o[0])}" ${String(val) === String(o[0]) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
    else input = `<input id="${id}" type="${fd.type || "text"}" value="${esc(val)}" placeholder="${esc(fd.ph || "")}" autocomplete="off">`;
    return `<div class="field" ${fd.half ? `data-half` : ""}><label for="${id}">${esc(fd.l)}</label>${input}${fd.hint ? `<p class="hint">${esc(fd.hint)}</p>` : ""}</div>`;
  });
  // pair up half fields
  const out = []; for (let i = 0; i < f.length; i++) { if (fields[i].half && fields[i + 1] && fields[i + 1].half) { out.push(`<div class="two">${f[i]}${f[i + 1]}</div>`); i++; } else out.push(f[i]); }
  const sc = sheet(`<h2>${esc(title)}</h2>${out.join("")}${extraHTML || ""}<button class="btn primary wide" data-save>儲存</button>${onDelete ? `<button class="btn danger" data-delete>刪除</button>` : ""}`);
  const read = () => { const o = {}; fields.forEach(fd => { const el = $("#f-" + fd.k, sc); let x = el.value; if (fd.type === "lines") x = x.split("\n").map(s => s.trim()).filter(Boolean); else if (typeof x === "string") x = x.trim(); o[fd.k] = x; }); return o; };
  $("[data-save]", sc).addEventListener("click", async () => { const r = await onSave(read(), sc); if (r !== false) sc._close(); });
  if (onDelete) { const b = $("[data-delete]", sc); b.addEventListener("click", async () => { if (!b.dataset.c) { b.dataset.c = 1; b.textContent = "再按一次確定刪除"; return; } await onDelete(); sc._close(); }); }
  if (onMount) onMount(sc, read);
  return sc;
}
function menuSheet(title, items) {
  const sc = sheet(`<h2>${esc(title)}</h2><div class="menu">${items.map((m, i) => `<button data-m="${i}" class="${m.danger ? "danger" : ""}">${esc(m.l)}</button>`).join("")}</div>`);
  sc.addEventListener("click", async e => { const b = e.target.closest("[data-m]"); if (!b) return; const m = items[Number(b.dataset.m)];
    if (m.danger && !b.dataset.c) { b.dataset.c = 1; b.textContent = "再按一次確定：" + m.l; return; }
    sc._close(); await m.fn(); });
}

/* ================= trip editing ================= */
const COUNTRY_OPTS = () => Object.entries(P.countries).map(([k, c]) => [k, c.flag + " " + c.name]);
function openNewTrip() {
  const start = addDays(todayISO(), 30);
  formSheet({
    title: "新增旅行",
    fields: [
      { k: "title", l: "旅行名稱", ph: "例如：京都賞楓五日" },
      { k: "country", l: "國家", type: "select", options: COUNTRY_OPTS() },
      { k: "cities", l: "城市（用頓號或逗號分開）", ph: "京都、大阪" },
      { k: "start", l: "出發", type: "date", half: true }, { k: "end", l: "回程", type: "date", half: true }
    ],
    value: { country: "JP", start, end: addDays(start, 4) },
    extraHTML: `<p class="hint">會依國家帶入當地常用 App、緊急電話和行李清單，之後都能改。</p>`,
    async onSave(v) {
      if (!v.title) { toast("請填旅行名稱"); return false; }
      if (!v.start || !v.end || v.end < v.start) { toast("請確認日期"); return false; }
      if (dayCount(v.start, v.end) > 60) { toast("最多 60 天"); return false; }
      const t = newTrip({ title: v.title, countryCode: v.country, cities: splitList(v.cities), start: v.start, end: v.end });
      await DB.putTrip(t); state.trips.push(t); state.trip = t; state.notes = [];
      go(`#/trip/${encodeURIComponent(t.id)}/overview`); toast("已建立");
    }
  });
}
const splitList = s => String(s || "").split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
function openEditTrip() {
  const t = state.trip;
  formSheet({
    title: "編輯旅行資料",
    fields: [
      { k: "title", l: "旅行名稱" }, { k: "subtitle", l: "副標", ph: "例如：The Shih Family Vacation" },
      { k: "country", l: "國家", type: "select", options: COUNTRY_OPTS() },
      { k: "cities", l: "城市" },
      { k: "start", l: "出發", type: "date", half: true }, { k: "end", l: "回程", type: "date", half: true },
      { k: "highlights", l: "行程亮點（一行一個）", type: "lines" }
    ],
    value: { ...t, cities: (t.cities || []).join("、") },
    async onSave(v) {
      if (!v.title || !v.start || !v.end || v.end < v.start) { toast("請確認名稱與日期"); return false; }
      const n = dayCount(v.start, v.end);
      const dropped = t.days.slice(n);
      if (dropped.some(d => d.items.length || state.notes.some(x => x.dayId === d.id))) { toast(`縮短後會刪掉的天數裡還有行程或紀錄，請先移走`); return false; }
      t.days = t.days.slice(0, n); while (t.days.length < n) t.days.push(newDay(""));
      t.days.forEach((d, i) => d.date = addDays(v.start, i));
      Object.assign(t, { title: v.title, subtitle: v.subtitle, country: v.country, cities: splitList(v.cities), start: v.start, end: v.end, highlights: v.highlights });
      await saveTrip(); render(); toast("已儲存");
    }
  });
}
function openTripMenu() {
  menuSheet(state.trip.title, [
    { l: "編輯旅行資料", fn: openEditTrip },
    { l: "發布給團員", fn: openPublish },
    { l: "複製成新旅行（當模板用）", fn: duplicateTrip },
    { l: "刪除這趟旅行（含紀錄）", danger: true, fn: async () => {
      for (const n of state.notes) await DB.delNote(n.id);
      await DB.delTrip(state.trip.id); state.trips = state.trips.filter(x => x.id !== state.trip.id);
      state.allNotes = state.allNotes.filter(n => n.tripId !== state.trip.id); state.trip = null; go("#/home/trips"); toast("已刪除"); } }
  ]);
}
async function duplicateTrip() {
  const t = clone(state.trip);
  t.id = uid("trip-"); t.title = t.title + "（複本）"; t.createdAt = Date.now(); delete t.published;
  t.days.forEach(d => { d.id = uid("d"); d.items = d.items.filter(it => !it.journalOnly && it.status !== "cancel").map(it => ({ ...it, id: uid("i"), status: "plan", replacedBy: undefined })); });
  t.packing.forEach(g => g.items.forEach(i => i.ok = false));
  await DB.putTrip(t); state.trips.push(t); state.trip = t; state.notes = [];
  go(`#/trip/${encodeURIComponent(t.id)}/overview`); toast("已複製，記得改日期");
}
function openEditDay() {
  const d = state.trip.days[state.day];
  formSheet({
    title: `編輯 D${state.day}`,
    fields: [
      { k: "title", l: "這天的標題", ph: "例如：渝中老城精華" },
      { k: "type", l: "類型", type: "select", options: Object.entries(P.types) },
      { k: "stay", l: "住宿" },
      { k: "meet", l: "集合時間地點" }, { k: "dress", l: "穿搭" }, { k: "bring", l: "要帶" },
      { k: "notes", l: "注意事項", type: "textarea" }, { k: "meal", l: "用餐" }
    ],
    value: { ...d, ...d.notice },
    async onSave(v) {
      Object.assign(d, { title: v.title, type: v.type, stay: v.stay });
      d.notice = { meet: v.meet, dress: v.dress, bring: v.bring, notes: v.notes, meal: v.meal };
      await saveTrip(); render(); toast("已儲存");
    }
  });
}
const ITEM_FIELDS = [
  { k: "time", l: "時間", type: "time", half: true }, { k: "dur", l: "停留", ph: "60 分鐘", half: true },
  { k: "title", l: "名稱" },
  { k: "place", l: "地點（點了會開地圖）", ph: "可填地名或地址" },
  { k: "desc", l: "說明", type: "textarea" },
  { k: "tips", l: "小標籤（一行一個）", type: "lines", ph: "拍照機位\n要預約" },
  { k: "link", l: "連結網址", ph: "https://…", half: true }, { k: "linkTitle", l: "連結名稱", ph: "紀錄片", half: true },
  { k: "niches", l: "重點編號（龕號／展品號，一行一個）", type: "lines" }
];
function openItemEditor(it, onCreate) {
  const d = state.trip.days[state.day];
  const isNew = !it;
  it = it || { id: uid("i"), time: "", title: "", status: "plan" };
  formSheet({
    title: isNew ? "新增行程" : "編輯行程",
    fields: ITEM_FIELDS, value: it,
    extraHTML: `<div class="row"><button class="btn sm" type="button" data-geo>找座標（放上足跡地圖）</button><span class="hint" data-geoinfo>${typeof it.lat === "number" ? `已定位 ${it.lat.toFixed(4)}, ${it.lng.toFixed(4)}` : "尚未定位"}</span></div>`,
    onMount(sc, read) {
      $("[data-geo]", sc).addEventListener("click", async () => {
        const v = read(); const q = [v.place || v.title, (state.trip.cities || [])[0], country(state.trip).name].filter(Boolean).join(" ");
        const info = $("[data-geoinfo]", sc); info.textContent = "搜尋中…";
        try {
          const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-TW&q=" + encodeURIComponent(q));
          const j = await r.json();
          if (!j.length) { info.textContent = "找不到，試試更完整的地名或地址"; return; }
          it.lat = Number(j[0].lat); it.lng = Number(j[0].lon); info.textContent = "已定位：" + j[0].display_name.split(",").slice(0, 3).join(",");
        } catch (e) { info.textContent = "連不上定位服務"; }
      });
    },
    async onSave(v) {
      if (!v.title) { toast("請填名稱"); return false; }
      Object.assign(it, v);
      if (isNew) { if (onCreate) onCreate(it); else d.items.push(it); }
      await saveTrip(); render(); toast("已儲存");
    },
    onDelete: isNew ? null : async () => { d.items = d.items.filter(x => x !== it); await saveTrip(); render(); }
  });
}
function openItemMenu(id) {
  const d = state.trip.days[state.day], it = d.items.find(x => x.id === id); if (!it) return;
  const m = [{ l: "編輯", fn: () => openItemEditor(it) }];
  if (it.status !== "cancel") {
    m.push({ l: it.status === "done" ? "取消「已完成」" : "標記已完成 ✓", fn: async () => { it.status = it.status === "done" ? "plan" : "done"; await saveTrip(); render(); } });
    if (!it.journalOnly) {
      m.push({ l: "取消（劃線保留，記得曾經規劃）", fn: async () => { it.status = "cancel"; await saveTrip(); render(); toast("已劃線保留"); } });
      m.push({ l: "改成別的行程（舊的劃線保留）", fn: () => openItemEditor(null, nw => { nw.time = nw.time || it.time; d.items.push(nw); it.status = "cancel"; it.replacedBy = nw.id; }) });
    } else {
      m.push({ l: "正式加入行程", fn: async () => { it.journalOnly = false; await saveTrip(); render(); toast("已加入行程"); } });
    }
  } else {
    m.push({ l: "恢復成行程", fn: async () => { it.status = "plan"; delete it.replacedBy; await saveTrip(); render(); } });
  }
  m.push({ l: "在這裡記錄", fn: () => openCompose({ itemId: it.id }) });
  m.push({ l: "刪除", danger: true, fn: async () => { d.items = d.items.filter(x => x !== it); await saveTrip(); render(); } });
  menuSheet(it.title, m);
}
function insertPoint(pos) {
  const d = state.trip.days[state.day];
  const sorted = sortItems(d.items);
  const prev = sorted[pos - 1], next = sorted[pos];
  let time = nowHM();
  if (d.date !== todayISO()) time = prev && prev.time ? prev.time : next && next.time ? next.time : "";
  formSheet({
    title: "插入記錄點",
    fields: [{ k: "title", l: "這個點叫什麼", ph: "例如：停車場、機場早餐" }, { k: "time", l: "時間", type: "time" }],
    value: { time },
    extraHTML: `<p class="hint">記錄點只出現在紀錄裡，不會動到發給團員的行程。</p>`,
    async onSave(v) {
      if (!v.title) { toast("取個名字"); return false; }
      const it = { id: uid("i"), time: v.time, title: v.title, status: "done", journalOnly: true };
      d.items.push(it); await saveTrip(); render();
      setTimeout(() => openCompose({ itemId: it.id }), 50);
    }
  });
}
/* generic record editors for info lists */
const REC_SPECS = {
  flights: { title: "航班", target: () => state.trip.flights, fields: [
    { k: "dir", l: "去／回程", ph: "去程", half: true }, { k: "date", l: "日期", ph: "08-23", half: true },
    { k: "no", l: "航班號碼", ph: "NX631" },
    { k: "from", l: "出發機場", half: true }, { k: "to", l: "抵達機場", half: true },
    { k: "dep", l: "起飛", type: "time", half: true }, { k: "arr", l: "抵達", type: "time", half: true },
    { k: "note", l: "備註", ph: "轉機 50 分鐘" }] },
  hotels: { title: "飯店", target: () => state.trip.hotels, fields: [
    { k: "dates", l: "入住日期", ph: "8/23–8/24" }, { k: "name", l: "飯店名稱" }, { k: "addr", l: "地址" }, { k: "tel", l: "電話" }] },
  contacts: { title: "聯絡人（加密）", target: () => state.trip.private.contacts, fields: [
    { k: "t", l: "角色", ph: "接機司機／導遊／包車" }, { k: "n", l: "名字與說明", ph: "黑色騰勢 D9｜車牌…" }, { k: "tel", l: "電話或微信" }] },
  emergency: { title: "緊急電話", target: () => state.trip.emergency, fields: [{ k: "n", l: "名稱" }, { k: "tel", l: "電話" }] },
  apps: { title: "App", target: () => state.trip.apps, fields: [
    { k: "n", l: "App 名稱" }, { k: "group", l: "分類", ph: "地圖交通" }, { k: "d", l: "說明" },
    { k: "url", l: "App Store 網址（選填）", ph: "https://apps.apple.com/…", hint: "在 App Store 按分享 → 拷貝連結，貼在這裡就會直接開到正確頁面" }] }
};
function openRecEditor(kind, idx) {
  const spec = REC_SPECS[kind], list = spec.target(), isNew = idx == null;
  formSheet({
    title: (isNew ? "新增" : "編輯") + spec.title, fields: spec.fields, value: isNew ? {} : list[idx],
    async onSave(v) { if (isNew) list.push(v); else list[idx] = v; await saveTrip(); render(); toast("已儲存"); },
    onDelete: isNew ? null : async () => { list.splice(idx, 1); await saveTrip(); render(); }
  });
}
function openTeamEditor() {
  const t = state.trip; t.team = t.team || { members: [], note: "", oath: [] };
  formSheet({ title: "領隊真心話與行前誓言", fields: [{ k: "note", l: "領隊真心話", type: "textarea" }, { k: "oath", l: "行前誓言（一行一句，會自動加「我發誓，」）", type: "lines" }], value: t.team,
    async onSave(v) { t.team.note = v.note; t.team.oath = v.oath; await saveTrip(); render(); } });
}
function openMemberEditor(i) {
  const t = state.trip, isNew = i == null;
  formSheet({ title: isNew ? "新增團員" : "編輯團員", fields: [{ k: "name", l: "名字" }, { k: "role", l: "職稱", ph: "副隊長" }, { k: "duty", l: "負責", ph: "掌控集合時間" }], value: isNew ? {} : t.team.members[i],
    async onSave(v) { if (!v.name) return false; if (isNew) t.team.members.push(v); else t.team.members[i] = v; await saveTrip(); render(); },
    onDelete: isNew ? null : async () => { t.team.members.splice(i, 1); await saveTrip(); render(); } });
}

/* ================= LINE notice ================= */
function lineText(i) {
  const t = state.trip, d = t.days[i], x = md(d.date), n = d.notice;
  const items = sortItems(d.items).filter(it => !it.journalOnly && it.status !== "cancel");
  const L = [`📢 明天 ${x.m}/${x.d}（${x.w}）D${i}｜${d.title || ""}`];
  if (n.meet) L.push(`⏰ 集合：${n.meet}`);
  if (items.length) { L.push(`🗺️ ${items.map(it => it.title).join(" → ")}`); items.filter(it => it.time).forEach(it => L.push(`　${it.time} ${it.title}`)); }
  if (n.dress) L.push(`👗 穿搭：${n.dress}`);
  if (n.bring) L.push(`🎒 記得帶：${n.bring}`);
  if (n.meal) L.push(`🍽️ 用餐：${n.meal}`);
  if (d.stay) L.push(`🏨 住宿：${d.stay}`);
  if (n.notes) L.push(`⚠️ 注意：${n.notes}`);
  if (t.published) L.push(`📖 行程：${shareLink(t)}`);
  return L.join("\n");
}
function openLine() {
  const key = "line:" + state.trip.days[state.day].id;
  const sc = sheet(`<h2>D${state.day} 的 LINE 通知</h2><p class="hint">前一晚發到群組。可以直接改文字，改過的內容會留著。</p>
    <div class="field"><label for="linetxt">通知內容</label><textarea id="linetxt" style="min-height:260px">${esc(ls.get(key, null) || lineText(state.day))}</textarea></div>
    <div class="row"><button class="btn primary" data-l="line">分享到 LINE</button><button class="btn" data-l="copy">複製</button><button class="btn ghost" data-l="reset">依行程重新產生</button></div>`);
  const ta = $("#linetxt", sc);
  ta.addEventListener("input", () => ls.set(key, ta.value));
  sc.addEventListener("click", e => { const b = e.target.closest("[data-l]"); if (!b) return;
    if (b.dataset.l === "copy") copyText(ta.value, ta);
    if (b.dataset.l === "reset") { ta.value = lineText(state.day); ls.set(key, null); }
    if (b.dataset.l === "line") shareText(ta.value); });
}
function shareText(txt) {
  location.href = "https://line.me/R/share?text=" + encodeURIComponent(txt);
}

/* ================= compose: photo / video / audio ================= */
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", .86));
  } catch (e) { return file; }
}
function pickMime() { if (!window.MediaRecorder) return ""; for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} } return ""; }
const extFor = type => /mp4|m4a|aac/.test(type) ? "m4a" : /quicktime|mov/.test(type) ? "mov" : /webm/.test(type) ? "webm" : /mpeg|mp3/.test(type) ? "mp3" : /jpeg|jpg/.test(type) ? "jpg" : /png/.test(type) ? "png" : "bin";
function guessItem(day) {
  const items = sortItems(day.items).filter(it => it.status !== "cancel");
  if (day.date !== todayISO()) return items[0] ? items[0].id : "";
  const now = nowHM(); let best = items[0];
  items.forEach(it => { if (it.time && it.time <= now) best = it; });
  return best ? best.id : "";
}
function openCompose(opts = {}) {
  const t = state.trip, existing = opts.note;
  let dayIdx = state.day;
  if (!existing && !opts.itemId) { const ti = todayIndex(t); if (ti >= 0) dayIdx = ti; }
  if (existing) dayIdx = Math.max(0, t.days.findIndex(d => d.id === existing.dayId));
  const n = existing ? { ...existing, media: [...(existing.media || [])] } : { id: uid("n"), tripId: t.id, dayId: t.days[dayIdx].id, ts: Date.now(), media: [], text: "" };
  let itemId = existing ? existing.itemId : (opts.itemId || guessItem(t.days[dayIdx]));
  let rec = null, stream = null, chunks = [], sr = null, timerId = null, t0 = 0;
  if (!existing && navigator.geolocation) navigator.geolocation.getCurrentPosition(p => { n.lat = p.coords.latitude; n.lng = p.coords.longitude; }, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });

  const itemOpts = () => { const d = t.days[dayIdx]; return sortItems(d.items).map(it => `<option value="${it.id}" ${it.id === itemId ? "selected" : ""}>${esc((it.time ? it.time + " " : "") + it.title)}${it.status === "cancel" ? "（已取消）" : ""}</option>`).join("") + `<option value="__new">＋ 新增記錄點（現在）</option><option value="" ${!itemId ? "selected" : ""}>不指定時間點</option>`; };
  const mediaList = () => n.media.map((m, i) => `<span class="chip x">${m.kind === "photo" ? "📷 照片" : m.kind === "video" ? "🎬 影片" : "🎙️ 錄音"}<button data-rm="${i}" aria-label="移除">×</button></span>`).join("");
  const sc = sheet(`<h2>${existing ? "編輯紀錄" : "記一則"}</h2>
    <div class="pickers">
      <label class="pick">📷 照片<input id="cin-photo" type="file" accept="image/*" multiple class="vh"></label>
      <label class="pick">🎬 影片<input id="cin-video" type="file" accept="video/*" class="vh"></label>
    </div>
    <div class="row" id="mlist">${mediaList()}</div>
    <div>
      <button class="recbig" id="recbtn" aria-label="開始錄音">錄音</button>
      <div class="timer" id="timer">00:00</div>
      <p class="hint" id="rechint" style="text-align:center">按一下開始、再按一下停止，講話會同步轉成文字</p>
    </div>
    <div class="field"><label for="ctext">文字</label><textarea id="ctext" placeholder="也可以按鍵盤上的麥克風口述">${esc(n.text)}</textarea></div>
    <div class="two"><div class="field"><label for="cday">哪一天</label><select id="cday">${t.days.map((d, i) => `<option value="${i}" ${i === dayIdx ? "selected" : ""}>D${i}・${esc(d.title || md(d.date).m + "/" + md(d.date).d)}</option>`).join("")}</select></div>
      <div class="field"><label for="citem">掛在哪個時間點</label><select id="citem">${itemOpts()}</select></div></div>
    <div class="field" id="newpt" hidden><label for="cnewpt">記錄點名稱</label><input id="cnewpt" placeholder="例如：停車場"></div>
    ${existing && n.media.some(m => m.kind === "audio") && ls.get("whisperKey", "") ? `<button class="btn" data-act2="stt">雲端轉文字（錄音）</button>` : ""}
    <button class="btn primary wide" id="savebtn">儲存</button>
    ${existing ? `<button class="btn danger" id="delnote">刪除這則</button>` : ""}`, stopAll);

  const ta = $("#ctext", sc), recbtn = $("#recbtn", sc), timer = $("#timer", sc), hint = $("#rechint", sc);
  const refresh = () => { $("#mlist", sc).innerHTML = mediaList(); };
  $("#cin-photo", sc).addEventListener("change", async e => { for (const f of e.target.files) n.media.push({ kind: "photo", blob: await shrinkImage(f), type: "image/jpeg" }); e.target.value = ""; refresh(); });
  $("#cin-video", sc).addEventListener("change", e => { const f = e.target.files[0]; if (f) { n.media.push({ kind: "video", blob: f, type: f.type || "video/quicktime" }); refresh(); } e.target.value = ""; });
  $("#mlist", sc).addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) { n.media.splice(Number(b.dataset.rm), 1); refresh(); } });
  $("#cday", sc).addEventListener("change", e => { dayIdx = Number(e.target.value); itemId = guessItem(t.days[dayIdx]); $("#citem", sc).innerHTML = itemOpts(); });
  $("#citem", sc).addEventListener("change", e => { $("#newpt", sc).hidden = e.target.value !== "__new"; });

  function stopAll() {
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) {}
    try { if (sr) { sr.onend = null; sr.stop(); } } catch (e) {}
    if (stream) stream.getTracks().forEach(x => x.stop());
    clearInterval(timerId);
  }
  function startSR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { hint.textContent = "這裡不支援即時轉文字，錄音仍會保存"; return; }
    sr = new SR(); sr.lang = "zh-TW"; sr.continuous = true; sr.interimResults = true;
    let fin = ""; const base = ta.value ? ta.value.replace(/\s+$/, "") + "\n" : "";
    sr.onresult = ev => { let mid = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript; else mid += r[0].transcript; } ta.value = base + fin + mid; };
    sr.onerror = ev => { if (ev.error !== "aborted" && ev.error !== "no-speech") hint.textContent = "即時轉文字沒成功，錄音仍有保存"; };
    sr.onend = () => { if (rec && rec.state === "recording") { try { sr.start(); } catch (e) {} } };
    try { sr.start(); } catch (e) {}
  }
  recbtn.addEventListener("click", async () => {
    if (rec && rec.state === "recording") { stopAll(); recbtn.classList.remove("on"); recbtn.textContent = "再錄一段"; return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { hint.textContent = "這裡無法使用麥克風，請從主畫面的 World 開啟"; return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { hint.textContent = "沒有麥克風權限：到 iPhone 設定 → Safari → 麥克風 允許"; return; }
    const mime = pickMime(); chunks = [];
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (e) { rec = new MediaRecorder(stream); }
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => { const type = rec.mimeType || mime || "audio/mp4"; n.media.push({ kind: "audio", blob: new Blob(chunks, { type }), type }); refresh(); };
    rec.start(1000); t0 = Date.now();
    timerId = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); timer.textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60); }, 250);
    recbtn.classList.add("on"); recbtn.textContent = "停止";
    startSR();
  });
  const sttBtn = sc.querySelector('[data-act2="stt"]');
  if (sttBtn) sttBtn.addEventListener("click", async () => { const a = n.media.find(m => m.kind === "audio"); const txt = await cloudSTT(a); if (txt) ta.value = (ta.value ? ta.value + "\n—\n" : "") + txt; });
  $("#savebtn", sc).addEventListener("click", async () => {
    if (rec && rec.state === "recording") { stopAll(); await new Promise(r => setTimeout(r, 500)); }
    n.text = ta.value.trim();
    if (!n.media.length && !n.text) { toast("先拍照、錄影、錄音或打幾個字"); return; }
    const day = t.days[dayIdx]; n.dayId = day.id;
    let sel = $("#citem", sc).value;
    if (sel === "__new") {
      const it = { id: uid("i"), time: nowHM(), title: $("#cnewpt", sc).value.trim() || "記錄點", status: "done", journalOnly: true };
      day.items.push(it); sel = it.id; await saveTrip();
    }
    n.itemId = sel || null;
    try { await DB.putNote(n); } catch (e) { toast("存不進去：" + (e.message || "請從主畫面的 World 開啟")); return; }
    await reloadNotes(); sc._close();
    state.day = dayIdx; state.dayMode = "record"; go(tripHash("day", dayIdx, "record")); toast("已儲存");
  });
  const del = $("#delnote", sc);
  if (del) del.addEventListener("click", async () => { if (!del.dataset.c) { del.dataset.c = 1; del.textContent = "再按一次確定刪除"; return; } await DB.delNote(n.id); await reloadNotes(); sc._close(); render(); });
}
async function reloadNotes() { state.notes = await DB.notes(state.trip.id); state.allNotes = await DB.allNotes(); }
function openViewer(key) {
  const [id, idx] = key.split(":"); const n = state.notes.find(x => x.id === id); if (!n) return;
  const m = n.media[Number(idx)]; if (!m) return;
  const u = URL.createObjectURL(m.blob);
  sheet(`<div class="lightbox">${m.kind === "video" ? `<video src="${u}" controls playsinline autoplay></video>` : `<img src="${u}" alt="照片">`}</div>
    <button class="btn" data-savefile>存到手機／分享</button>`, () => URL.revokeObjectURL(u))
    .querySelector("[data-savefile]").addEventListener("click", () => shareFile(m.blob, `world-${id}.${extFor(m.type || m.blob.type)}`));
}
async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
async function cloudSTT(a) {
  const key = ls.get("whisperKey", ""); if (!key || !a) return "";
  toast("轉文字中…");
  try {
    const fd = new FormData(); fd.append("file", a.blob, "memo." + extFor(a.type || a.blob.type)); fd.append("model", "whisper-1"); fd.append("language", "zh"); fd.append("prompt", "以下是繁體中文的旅遊語音筆記。");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd });
    if (!r.ok) throw new Error(r.status === 401 ? "金鑰不正確" : "錯誤 " + r.status);
    return ((await r.json()).text || "").trim();
  } catch (e) { toast("轉文字失敗：" + e.message); return ""; }
}

/* ================= map & KML ================= */
function allPoints() {
  const pts = [];
  state.trips.forEach((t, ti) => {
    t.days.forEach((d, di) => d.items.forEach(it => { if (typeof it.lat === "number" && it.status !== "cancel") pts.push({ lat: it.lat, lng: it.lng, title: it.title, trip: t.title, date: d.date, ti }); }));
  });
  state.allNotes.forEach(n => { if (typeof n.lat === "number") { const t = state.trips.find(x => x.id === n.tripId); if (t) pts.push({ lat: n.lat, lng: n.lng, title: (n.text || "紀錄").slice(0, 30), trip: t.title, date: isoOf(new Date(n.ts)), ti: state.trips.indexOf(t), note: true }); } });
  return pts;
}
const TRIP_COLORS = ["#C8402B", "#3A6EA5", "#2E8B6E", "#D9822B", "#7B5EA7", "#8A6A4F", "#1F8A99"];
function mountMap() {
  const el = $("#map"); if (!el) return;
  if (!window.L) { el.innerHTML = `<div class="empty"><b>地圖載入中</b>需要網路連線</div>`; return; }
  mapInst = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(mapInst);
  const pts = allPoints();
  if (!pts.length) { mapInst.setView([23.7, 121], 4); return; }
  const group = L.featureGroup(pts.map(p => L.circleMarker([p.lat, p.lng], { radius: p.note ? 5 : 7, color: "#fff", weight: 2, fillColor: TRIP_COLORS[p.ti % TRIP_COLORS.length], fillOpacity: .95 })
    .bindPopup(`<b>${esc(p.title)}</b><br>${esc(p.trip)}・${esc(p.date)}`))).addTo(mapInst);
  mapInst.fitBounds(group.getBounds().pad(0.2), { maxZoom: 12 });
}
function exportKML() {
  const pts = allPoints(); if (!pts.length) { toast("還沒有定位過的地點"); return; }
  const x = s => String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>World 足跡</name>${pts.map(p => `<Placemark><name>${x(p.title)}</name><description>${x(p.trip + " " + p.date)}</description><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`).join("")}</Document></kml>`;
  shareFile(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), "world-足跡.kml");
}

/* ================= crypto & publish ================= */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64(bytes) { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}
async function decryptJSON(box, pw) {
  const key = await deriveKey(pw, unb64(box.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(dec.decode(pt));
}
function shareLink(t) { return location.origin + location.pathname.replace(/index\.html$/, "") + "?t=" + encodeURIComponent(t.id); }
function repoName() { return ls.get("repo", "fuwei0618-cmd/World"); }
async function gh(path, opt = {}) {
  const token = ls.get("ghToken", "");
  const r = await fetch("https://api.github.com/repos/" + repoName() + path, { ...opt, headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, ...(opt.headers || {}) } });
  return r;
}
function openPublish() {
  const t = state.trip;
  const hasToken = !!ls.get("ghToken", "");
  const pw = ls.get("teampw:" + t.id, "");
  const sc = sheet(`<h2>發布給團員</h2>
    ${!hasToken ? `<div class="card lock"><b>還沒設定 GitHub 金鑰</b><p class="hint">回到旅行列表 → 右上角設定 → 貼上 GitHub 金鑰，就能從手機發布。</p></div>` : ""}
    <div class="field"><label for="tpw">團員密碼</label><input id="tpw" type="text" value="${esc(pw)}" placeholder="至少 4 個字" autocomplete="off"><p class="hint">聯絡人與保險會用這組密碼加密。告訴團員就好，不要放在公開的地方。</p></div>
    <ul class="hint" style="padding-left:18px;margin:0"><li>會發布：行程、景點、飯店、航班、行李清單、App、緊急電話</li><li>會加密：聯絡人、保險</li><li>不會發布：你的照片、影片、錄音、文字紀錄、記錄點</li></ul>
    <button class="btn primary wide" id="dopub" ${hasToken ? "" : "disabled"}>${t.published ? "更新團員版本" : "發布"}</button>
    <div id="pubres">${t.published ? pubResult(t) : ""}</div>`);
  $("#dopub", sc).addEventListener("click", async e => {
    const btn = e.currentTarget; const p = $("#tpw", sc).value.trim();
    if (p.length < 4) { toast("密碼至少 4 個字"); return; }
    btn.disabled = true; btn.textContent = "發布中…";
    try {
      ls.set("teampw:" + t.id, p);
      const pub = clone(t); delete pub.private;
      pub.days.forEach(d => d.items = d.items.filter(it => !it.journalOnly));
      pub.locked = await encryptJSON(t.private || {}, p);
      pub.publishedAt = Date.now();
      const path = `/contents/trips/${encodeURIComponent(t.id)}.json`;
      let sha; const head = await gh(path); if (head.ok) sha = (await head.json()).sha; else if (head.status === 401 || head.status === 403) throw new Error("GitHub 金鑰沒有權限，請確認勾了 World 和 Contents 讀寫");
      const body = { message: `發布 ${t.title}`, content: b64(enc.encode(JSON.stringify(pub))), ...(sha ? { sha } : {}) };
      const r = await gh(path, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || "錯誤 " + r.status); }
      t.published = { at: Date.now() }; await saveTrip();
      $("#pubres", sc).innerHTML = pubResult(t); toast("已發布，約 1 分鐘後團員就看得到");
    } catch (err) { toast("發布失敗：" + (err.message || "請檢查網路")); }
    btn.disabled = false; btn.textContent = "更新團員版本";
  });
  sc.addEventListener("click", e => { const b = e.target.closest("[data-pub]"); if (!b) return;
    const link = shareLink(t);
    if (b.dataset.pub === "copy") copyText(link);
    if (b.dataset.pub === "line") shareText(`📖 ${t.title} 行程手冊\n${link}\n（聯絡資訊的密碼另外告訴大家）`); });
}
function pubResult(t) {
  const x = new Date(t.published.at);
  return `<div class="card stack"><div class="eyebrow">團員網址</div><div class="mono" style="word-break:break-all;user-select:all">${esc(shareLink(t))}</div>
    <div class="row"><button class="btn sm" data-pub="copy">複製網址</button><button class="btn sm primary" data-pub="line">傳到 LINE</button></div>
    <p class="hint">上次發布：${x.getMonth() + 1}/${x.getDate()} ${pad(x.getHours())}:${pad(x.getMinutes())}。行程改了要再按一次發布。</p></div>`;
}

/* ================= settings & backup ================= */
function openSettings() {
  const sc = sheet(`<h2>設定</h2>
    <div class="field"><label for="s-gh">GitHub 金鑰（發布給團員用）</label><input id="s-gh" type="password" value="${esc(ls.get("ghToken", ""))}" placeholder="github_pat_…" autocomplete="off"><p class="hint">只存在這支手機。只能修改 World，到 GitHub 隨時可以刪掉。</p></div>
    <div class="field"><label for="s-repo">發布到哪個 repo</label><input id="s-repo" value="${esc(repoName())}"></div>
    <div class="field"><label for="s-wk">OpenAI 金鑰（選用：雲端轉文字）</label><input id="s-wk" type="password" value="${esc(ls.get("whisperKey", ""))}" placeholder="sk-…" autocomplete="off"><p class="hint">沒填也能用，iPhone 會在錄音時即時轉文字。</p></div>
    <button class="btn primary" id="s-save">儲存設定</button>
    <div class="field"><label>外觀</label><div class="seg"><button data-th="">跟系統</button><button data-th="light">淺色</button><button data-th="dark">深色</button></div></div>
    <div class="field"><label>資料備份</label><p class="hint">行程和紀錄都存在這支手機。換手機前、或旅行回來後，記得匯出備份。</p>
      <div class="row"><button class="btn" data-bk="export">匯出全部資料</button><label class="btn">匯入備份<input id="s-import" type="file" accept=".zip,application/zip" class="vh"></label></div></div>
    <div class="field"><label>範例</label><button class="btn ghost" data-bk="sample">載入重慶 2026 範例</button></div>`);
  $("#s-save", sc).addEventListener("click", () => { ls.set("ghToken", $("#s-gh", sc).value.trim()); ls.set("repo", $("#s-repo", sc).value.trim() || "fuwei0618-cmd/World"); ls.set("whisperKey", $("#s-wk", sc).value.trim()); toast("已儲存"); sc._close(); });
  sc.addEventListener("click", async e => {
    const th = e.target.closest("[data-th]"); if (th) { ls.set("theme", th.dataset.th || null); applyTheme(); }
    const bk = e.target.closest("[data-bk]");
    if (bk && bk.dataset.bk === "export") exportAll();
    if (bk && bk.dataset.bk === "sample") { sc._close(); loadSample(); }
  });
  $("#s-import", sc).addEventListener("change", async e => { const f = e.target.files[0]; if (f) { sc._close(); await importAll(f); } });
}
function applyTheme() { const v = ls.get("theme", null); if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme"); }
async function exportAll() {
  if (!window.JSZip) { toast("備份工具需要網路，連上後再試"); return; }
  toast("打包中…");
  const zip = new JSZip(), notes = await DB.allNotes();
  zip.file("trips.json", JSON.stringify(state.trips, null, 1));
  const meta = notes.map(n => ({ ...n, media: (n.media || []).map((m, i) => { const f = `media/${n.tripId}/${n.id}-${i}.${extFor(m.type || m.blob.type)}`; zip.file(f, m.blob); return { kind: m.kind, type: m.type, file: f }; }) }));
  zip.file("notes.json", JSON.stringify(meta, null, 1));
  const blob = await zip.generateAsync({ type: "blob" });
  shareFile(new Blob([blob], { type: "application/zip" }), `World-備份-${todayISO()}.zip`);
}
async function importAll(file) {
  if (!window.JSZip) { toast("備份工具需要網路"); return; }
  try {
    const zip = await JSZip.loadAsync(file);
    const trips = JSON.parse(await zip.file("trips.json").async("string"));
    const notes = zip.file("notes.json") ? JSON.parse(await zip.file("notes.json").async("string")) : [];
    for (const t of trips) await DB.putTrip(t);
    for (const n of notes) { n.media = await Promise.all((n.media || []).map(async m => ({ kind: m.kind, type: m.type, blob: new Blob([await zip.file(m.file).async("arraybuffer")], { type: m.type }) }))); await DB.putNote(n); }
    await boot(); toast(`已匯入 ${trips.length} 趟旅行、${notes.length} 則紀錄`);
  } catch (e) { toast("匯入失敗：檔案不是 World 備份"); }
}
async function loadSample() {
  try {
    const r = await fetch("samples/chongqing-2026.json"); const t = await r.json();
    if (state.trips.some(x => x.id === t.id)) { toast("範例已經在列表裡"); return; }
    await DB.putTrip(t); state.trips.push(t); go("#/home/trips"); render(); toast("已載入重慶範例");
  } catch (e) { toast("範例載入失敗"); }
}

/* ================= events ================= */
tabsEl.addEventListener("click", e => {
  const b = e.target.closest("[data-tab]"); if (!b) return; const k = b.dataset.tab;
  if (k.startsWith("home:")) return go("#/home/" + k.slice(5));
  if (k === "rec") return openCompose();
  if (k === "day") return go(tripHash("day", state.day, state.dayMode));
  go(tripHash(k));
});
app.addEventListener("click", async e => {
  const t = e.target;
  const nav = t.closest("[data-nav]"); if (nav) return go(nav.dataset.nav);
  const op = t.closest("[data-open]"); if (op) { state.day = 0; return go(`#/trip/${encodeURIComponent(op.dataset.open)}/overview`); }
  const dayB = t.closest("[data-day]"); if (dayB) { state.day = Number(dayB.dataset.day); return go(tripHash("day", state.day)); }
  const mode = t.closest("[data-mode]"); if (mode) return go(tripHash("day", state.day, mode.dataset.mode));
  const act = t.closest("[data-act]")?.dataset.act;
  const A = {
    newtrip: openNewTrip, sample: loadSample, settings: openSettings, kml: exportKML,
    tripmenu: openTripMenu, edittrip: openEditTrip, publish: openPublish, editday: openEditDay,
    additem: () => openItemEditor(null), line: openLine, editteam: openTeamEditor,
    addteam: async () => { state.trip.team = { members: [], note: "", oath: [] }; await saveTrip(); render(); openMemberEditor(); },
    addmember: () => openMemberEditor(),
    togglecancel: () => { state.showCancelled = !state.showCancelled; render(); },
    addgroup: () => formSheet({ title: "新增行李分類", fields: [{ k: "group", l: "分類名稱" }], async onSave(v) { if (!v.group) return false; state.trip.packing.push({ group: v.group, items: [] }); await saveTrip(); render(); } }),
    cleargroup: async () => { const g = Number(t.closest("[data-g]").dataset.g); state.trip.packing[g].items.forEach(i => i.ok = false); await saveTrip(); render(); },
    addapp: () => openRecEditor("apps"),
    editins: () => formSheet({ title: "旅遊保險（加密）", fields: [{ k: "co", l: "保險公司" }, { k: "tel", l: "海外急難救助電話" }, { k: "policy", l: "保單號碼" }, { k: "note", l: "備註", type: "textarea" }], value: state.trip.private.insurance, async onSave(v) { state.trip.private.insurance = v; await saveTrip(); render(); } }),
    editsafety: () => formSheet({ title: "就近醫院・防走丟", fields: [{ k: "hospital", l: "就近醫院" }, { k: "lostPlan", l: "防走丟方式" }], value: state.trip, async onSave(v) { state.trip.hospital = v.hospital; state.trip.lostPlan = v.lostPlan; await saveTrip(); render(); } })
  };
  if (act && A[act]) return A[act]();
  const cp = t.closest("[data-copy]"); if (cp) return copyText(cp.dataset.copy);
  const im = t.closest("[data-item]"); if (im) return openItemMenu(im.dataset.item);
  const rc = t.closest("[data-rec]"); if (rc) return openCompose({ itemId: rc.dataset.rec });
  const ins = t.closest("[data-insert]"); if (ins) return insertPoint(Number(ins.dataset.insert));
  const en = t.closest("[data-editnote]"); if (en) return openCompose({ note: state.notes.find(n => n.id === en.dataset.editnote) });
  const vw = t.closest("[data-view]"); if (vw) return openViewer(vw.dataset.view);
  const mb = t.closest("[data-member]"); if (mb) return openMemberEditor(Number(mb.dataset.member));
  const ra = t.closest("[data-rec-add]"); if (ra) return openRecEditor(ra.dataset.recAdd);
  const re = t.closest("[data-rec-edit]"); if (re) { const [k, i] = re.dataset.recEdit.split(":"); return openRecEditor(k, Number(i)); }
  const ap = t.closest("[data-app]"); if (ap) return openRecEditor("apps", Number(ap.dataset.app));
  const dp = t.closest("[data-delpack]"); if (dp) { e.preventDefault(); const [g, i] = dp.dataset.delpack.split("-").map(Number); state.trip.packing[g].items.splice(i, 1); await saveTrip(); return render(); }
  const df = t.closest("[data-delfood]"); if (df) { const [k, i] = df.dataset.delfood.split(":"); state.trip.food[k].splice(Number(i), 1); await saveTrip(); return render(); }
  const ni = t.closest("[data-niche]"); if (ni) { const m = ls.get("niche", {}); m[ni.dataset.niche] = !m[ni.dataset.niche]; ls.set("niche", m); return render(); }
});
app.addEventListener("change", async e => {
  const p = e.target.closest("[data-pack]"); if (!p) return;
  const [g, i] = p.dataset.pack.split("-").map(Number);
  if (isOwner()) { state.trip.packing[g].items[i].ok = p.checked; await saveTrip(); }
  else { const m = ls.get("pack:" + state.trip.id, {}); m[g + "-" + i] = p.checked; ls.set("pack:" + state.trip.id, m); }
  const ps = packState(); let total = 0, done = 0;
  state.trip.packing.forEach((gg, gi) => gg.items.forEach((_, ii) => { total++; if (ps.get(gi, ii)) done++; }));
  $("#packbar").style.width = (done / total * 100) + "%"; $("#packcount").textContent = done + "/" + total;
});
app.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  if (f.dataset.addpack != null) { const g = Number(f.dataset.addpack), inp = f.querySelector("input"); if (!inp.value.trim()) return; state.trip.packing[g].items.push({ t: inp.value.trim(), ok: false }); await saveTrip(); render(); }
  if (f.dataset.addfood != null) { const inp = f.querySelector("input"); if (!inp.value.trim()) return; state.trip.food[f.dataset.addfood].push(inp.value.trim()); await saveTrip(); render(); }
  if (f.dataset.unlock != null) {
    const pw = $("#unlockpw").value;
    try { state.unlocked = await decryptJSON(state.trip.locked, pw); ls.set("teampw:" + state.trip.id, pw); render(); toast("已解鎖"); }
    catch (err) { toast("密碼不對"); }
  }
});
window.addEventListener("hashchange", route);

/* ================= boot ================= */
async function boot() {
  applyTheme();
  if (state.viewer) {
    try {
      const r = await fetch(`trips/${encodeURIComponent(VIEWER_ID)}.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      state.trip = await r.json();
      document.title = state.trip.title;
      const pw = ls.get("teampw:" + state.trip.id, "");
      if (pw && state.trip.locked) { try { state.unlocked = await decryptJSON(state.trip.locked, pw); } catch (e) {} }
    } catch (e) { state.trip = null; }
    if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "#/trip/" + encodeURIComponent(VIEWER_ID) + "/overview");
    parseHash(); state.view = "trip"; render(); return;
  }
  await DB.open();
  state.trips = await DB.allTrips();
  state.allNotes = await DB.allNotes();
  state.trip = null;
  await route();
}
boot();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
