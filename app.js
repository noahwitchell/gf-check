import { checkProduct, GRADES, highlight, scanReview, scanMenu, SIGNAL_INFO } from "./rules.js";
import * as AI from "./ai.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- storage (stays on this phone) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("gfc." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("gfc." + k, JSON.stringify(v)); } catch {} },
};
let history = store.get("history", []);      // [{code,name,brand,img,grade,time}]
let overrides = store.get("overrides", {});  // code -> {verdict:'gf'|'gluten', time}
let places = store.get("places", []);        // [{id,name,area,evidence:[...]}]
const save = () => { store.set("history", history); store.set("overrides", overrides); store.set("places", places); };

// ---------- tabs ----------
const TITLES = { scan: "Groceries", places: "Restaurants", history: "History", ai: "AI reader" };
function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $("#screen-title").textContent = TITLES[name];
  if (name !== "scan") stopScan();
  if (name === "history") renderHistory();
  if (name === "places") renderPlaces();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------- barcode scanning ----------
let scanner = null;
async function startScan() {
  if (!window.Html5Qrcode) { alert("The scanner library didn't load. Check the connection and reload."); return; }
  $("#reader").hidden = false; $("#btn-scan").hidden = true; $("#btn-stop").hidden = false;
  const F = window.Html5QrcodeSupportedFormats;
  scanner = new Html5Qrcode("reader", { formatsToSupport: [F.EAN_13, F.UPC_A, F.UPC_E, F.EAN_8], verbose: false });
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 260, height: 140 }, aspectRatio: 1.6 },
      code => { if (navigator.vibrate) navigator.vibrate(60); stopScan(); lookup(code); }, () => {});
  } catch (e) {
    stopScan();
    alert("Couldn't open the camera: " + (e.message || e) + "\nYou can type the barcode number instead.");
  }
}
async function stopScan() {
  if (scanner) { try { await scanner.stop(); scanner.clear(); } catch {} scanner = null; }
  $("#reader").hidden = true; $("#btn-scan").hidden = false; $("#btn-stop").hidden = true;
}
$("#btn-scan").onclick = startScan;
$("#btn-stop").onclick = stopScan;
$("#form-code").onsubmit = e => { e.preventDefault(); const c = $("#in-code").value.replace(/\D/g, ""); if (c) lookup(c); };

// ---------- product lookup (Open Food Facts) ----------
const OFF = "https://world.openfoodfacts.org";
const FIELDS = "code,product_name,brands,image_front_small_url,image_small_url,ingredients_text,ingredients_text_en,allergens_tags,traces_tags,labels_tags,last_modified_t,countries_tags";

async function lookup(code) {
  $("#search-results").innerHTML = "";
  $("#product").innerHTML = `<div class="card muted">Looking up ${esc(code)}…</div>`;
  try {
    const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
    const j = await r.json();
    if (j.status !== 1 || !j.product) {
      $("#product").innerHTML = `<div class="card"><b>Not in the database.</b><p class="muted small">Barcode ${esc(code)} isn't in Open Food Facts yet. Check the package for a gluten-free label and the ingredient list. You can also add the product at <a href="${OFF}/product/${esc(code)}" target="_blank" rel="noopener">openfoodfacts.org</a> so it's there next time.</p></div>`;
      return;
    }
    renderProduct({ ...j.product, code: j.code || code });
  } catch (e) {
    $("#product").innerHTML = `<div class="card"><b>Lookup failed.</b><p class="muted small">${esc(e.message)}. Check the connection and try again.</p></div>`;
  }
}

function renderProduct(p) {
  const res = checkProduct(p);
  const g = GRADES[res.grade];
  const img = p.image_front_small_url || p.image_small_url || "";
  const name = p.product_name || "Unnamed product";
  const brand = (p.brands || "").split(",")[0].trim();
  const ov = overrides[p.code];
  const uniq = hits => [...new Map(hits.map(h => [h.label, h])).values()];
  const updated = p.last_modified_t ? new Date(p.last_modified_t * 1000).toLocaleDateString() : "unknown";

  const reasonList = [
    ...uniq(res.contains).map(h => `<li><b>${esc(h.word)}</b>: ${esc(h.label)}</li>`),
    ...uniq(res.caution).map(h => `<li><b>${esc(h.word)}</b>: ${esc(h.label)}</li>`),
    ...res.reasons.map(r => `<li>${esc(r)}</li>`),
  ].join("");

  $("#product").innerHTML = `
    <div class="card">
      <div class="prod-head">
        ${img ? `<img src="${esc(img)}" alt="">` : ""}
        <div><div class="name">${esc(name)}</div><div class="brand">${esc(brand)} · ${esc(p.code)}</div></div>
      </div>
    </div>
    <div class="grade tone-${g.tone}">
      <div class="t">${esc(g.title)}</div>
      ${reasonList ? `<ul>${reasonList}</ul>` : ""}
    </div>
    ${ov ? `<div class="card small"><b>Your check:</b> you marked the package as ${ov.verdict === "gf" ? "gluten-free" : "containing gluten"} on ${new Date(ov.time).toLocaleDateString()}.</div>` : ""}
    <div class="card">
      <h2>Ingredients</h2>
      ${res.ingredients ? `<div class="ingr">${highlight(res.ingredients, res, esc)}</div>` : `<p class="muted">No ingredient list in the database.</p>`}
      ${res.notes.length ? `<h3>Usually fine</h3><ul class="small muted">${uniq(res.notes).map(h => `<li>${esc(h.label)}</li>`).join("")}</ul>` : ""}
      <p class="muted small">Database entry last updated ${esc(updated)}. Recipes change, so check the package when it matters.</p>
      <h3>What does the package say?</h3>
      <div class="override">
        <button data-v="gf" class="${ov?.verdict === "gf" ? "sel" : ""}">It says gluten-free</button>
        <button data-v="gluten" class="${ov?.verdict === "gluten" ? "sel" : ""}">It contains gluten</button>
        ${ov ? `<button data-v="clear">Clear</button>` : ""}
      </div>
      <p class="small"><a href="${OFF}/product/${esc(p.code)}" target="_blank" rel="noopener">See or fix this product on Open Food Facts</a></p>
    </div>`;

  $("#product").querySelectorAll(".override button").forEach(b => b.onclick = () => {
    if (b.dataset.v === "clear") delete overrides[p.code]; else overrides[p.code] = { verdict: b.dataset.v, time: Date.now() };
    save(); renderProduct(p);
  });

  history = history.filter(h => h.code !== p.code);
  history.unshift({ code: p.code, name, brand, img, grade: res.grade, time: Date.now() });
  history = history.slice(0, 200);
  save();
}

// ---------- search by name ----------
$("#form-search").onsubmit = async e => {
  e.preventDefault();
  const q = $("#in-search").value.trim(); if (!q) return;
  $("#product").innerHTML = "";
  $("#search-results").innerHTML = `<div class="card muted">Searching…</div>`;
  try {
    const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20` +
      `&tagtype_0=countries&tag_contains_0=contains&tag_0=united-states&fields=code,product_name,brands,image_front_small_url`;
    const j = await (await fetch(url)).json();
    const items = (j.products || []).filter(p => p.product_name);
    $("#search-results").innerHTML = items.length ? `<div class="card">${items.map(p => `
      <div class="list-item" data-code="${esc(p.code)}">
        ${p.image_front_small_url ? `<img src="${esc(p.image_front_small_url)}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:#fff">` : `<div style="width:40px"></div>`}
        <div class="grow"><div><b>${esc(p.product_name)}</b></div><div class="muted small">${esc((p.brands || "").split(",")[0])}</div></div>
      </div>`).join("")}</div>` : `<div class="card muted">No matches.</div>`;
    $("#search-results").querySelectorAll(".list-item").forEach(el => el.onclick = () => lookup(el.dataset.code));
  } catch (err) {
    $("#search-results").innerHTML = `<div class="card">Search failed: ${esc(err.message)}</div>`;
  }
};

// ---------- history ----------
function renderHistory() {
  if (!history.length) { $("#history").innerHTML = `<div class="empty">Products you look up will show here.</div>`; return; }
  $("#history").innerHTML = `<div class="card">${history.map(h => {
    const g = GRADES[h.grade] || GRADES.unknown; const ov = overrides[h.code];
    return `<div class="list-item" data-code="${esc(h.code)}">
      <span class="dot ${g.tone}"></span>
      <div class="grow"><div><b>${esc(h.name)}</b></div><div class="muted small">${esc(g.title)}${ov ? ` · you checked: ${ov.verdict === "gf" ? "GF" : "gluten"}` : ""}</div></div>
    </div>`; }).join("")}</div>`;
  $("#history").querySelectorAll(".list-item").forEach(el => el.onclick = () => { showTab("scan"); lookup(el.dataset.code); });
}

// ---------- restaurants ----------
const SOURCES = ["Google", "Yelp", "Find Me Gluten Free", "Reddit", "Restaurant website", "My visit", "Other"];
let openPlace = null;

// Rules and AI findings merged; each one says who found it.
function evSignals(ev) {
  const m = new Map();
  (ev.signals || []).forEach(x => m.set(x.key + "|" + x.quote, { key: x.key, quote: x.quote, by: "rules" }));
  (ev.ai?.findings || []).forEach(f => {
    const k = f.type + "|" + f.quote;
    if (m.has(k)) m.get(k).by = "rules + AI"; else m.set(k, { key: f.type, quote: f.quote, by: "AI" });
  });
  return [...m.values()];
}

function placeSignals(place) {
  const all = [];
  for (const ev of place.evidence) {
    if (ev.kind !== "review") continue;
    evSignals(ev).forEach(x => all.push({ ...x, source: ev.source, ...SIGNAL_INFO[x.key] }));
  }
  return all;
}

function renderPlaces() {
  $("#place-detail").hidden = true; $("#places-list").hidden = false; openPlace = null;
  $("#places-list").innerHTML = `
    <form id="form-place" class="card">
      <h2>Add a restaurant</h2>
      <input id="in-place" placeholder="Restaurant name" required>
      <div class="row"><input id="in-area" placeholder="Neighborhood or city (optional)"><button class="primary" type="submit">Add</button></div>
    </form>
    ${places.length ? `<div class="card">${places.map(p => {
      const s = placeSignals(p); const good = s.filter(x => x.good).length, bad = s.filter(x => !x.good).length;
      const tone = !s.length ? "none" : bad === 0 ? "safe" : bad > good ? "bad" : "warn";
      return `<div class="list-item" data-id="${p.id}"><span class="dot ${tone}"></span>
        <div class="grow"><div><b>${esc(p.name)}</b></div><div class="muted small">${esc(p.area || "")}${p.area ? " · " : ""}${p.evidence.length} source${p.evidence.length === 1 ? "" : "s"} · ${good} good, ${bad} warning${bad === 1 ? "" : "s"}</div></div></div>`;
    }).join("")}</div>` : `<div class="empty">Add a restaurant, then paste in its reviews or menu.</div>`}`;
  $("#form-place").onsubmit = e => {
    e.preventDefault();
    const p = { id: uid(), name: $("#in-place").value.trim(), area: $("#in-area").value.trim(), evidence: [], created: Date.now() };
    if (!p.name) return; places.unshift(p); save(); showPlace(p.id);
  };
  $("#places-list").querySelectorAll(".list-item").forEach(el => el.onclick = () => showPlace(el.dataset.id));
}

function callQuestions(sig) {
  const has = k => sig.some(s => s.key === k);
  const q = [];
  if (!has("dedicated_gf")) {
    if (!has("dedicated_fryer") || has("shared_fryer")) q.push("Are the fries and other fried foods cooked in a fryer that never gets breaded or wheat items?");
    if (!has("separate_prep")) q.push("Do you prep gluten-free orders on a separate, cleaned surface with clean utensils and fresh gloves?");
    q.push("Is the gluten-free bread, bun or pasta toasted, grilled or boiled separately?");
    if (has("cross_contact")) q.push("Reviews mention cross-contact warnings. Is the kitchen able to serve someone with celiac safely?");
  }
  q.push("Are any sauces, marinades or dressings made with soy sauce, flour or malt?");
  return q;
}

function showPlace(id) {
  const p = places.find(x => x.id === id); if (!p) return renderPlaces();
  openPlace = id;
  $("#places-list").hidden = true; $("#place-detail").hidden = false;
  const sig = placeSignals(p);
  const good = sig.filter(s => s.good), bad = sig.filter(s => !s.good);
  const byKey = list => { const m = {}; list.forEach(s => (m[s.key] ||= []).push(s)); return m; };
  const block = (list, cls) => Object.entries(byKey(list)).map(([k, arr]) => `
    <div class="signal ${cls}"><div class="lab">${esc(SIGNAL_INFO[k].label)} ×${arr.length}</div>
    ${arr.slice(0, 3).map(s => `<q>“${esc(s.quote)}” <span class="small">(${esc(s.source)}, ${esc(s.by)})</span></q>`).join("")}</div>`).join("");

  $("#place-detail").innerHTML = `
    <div class="row" style="margin:0 0 10px"><button class="link" id="btn-back">‹ All restaurants</button></div>
    <div class="card">
      <h2>${esc(p.name)}</h2><div class="muted small">${esc(p.area || "")}</div>
      <div class="score" style="margin-top:10px">
        <div class="tone-safe"><b>${good.length}</b>good signs</div>
        <div class="tone-bad"><b>${bad.length}</b>warnings</div>
        <div class="tone-none"><b>${p.evidence.length}</b>sources</div>
      </div>
    </div>
    ${sig.length ? `<div class="card"><h2>What reviews say</h2>${block(bad, "bad")}${block(good, "good")}</div>` : ""}
    <div class="card"><h2>Ask when you call</h2><ul class="small">${callQuestions(sig).map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>
    <form id="form-ev" class="card">
      <h2>Add a review or menu</h2>
      <p class="muted small">Paste text from Google, Yelp, Find Me Gluten Free, Reddit or the restaurant's menu. Automatic fetching comes in a later step.</p>
      <div class="row">
        <select id="ev-kind"><option value="review">Review(s)</option><option value="menu">Menu</option></select>
        <select id="ev-source">${SOURCES.map(s => `<option>${esc(s)}</option>`).join("")}</select>
      </div>
      <textarea id="ev-text" style="margin-top:10px" placeholder="Paste here" required></textarea>
      <div class="row"><button class="primary" type="submit">Check it</button></div>
    </form>
    <div id="ev-list">${p.evidence.map(ev => renderEvidence(ev)).join("")}</div>
    <div class="row"><button id="btn-del-place">Delete this restaurant</button></div>`;

  $("#btn-back").onclick = renderPlaces;
  $("#btn-del-place").onclick = () => { if (confirm(`Delete ${p.name} and its saved reviews?`)) { places = places.filter(x => x.id !== id); save(); renderPlaces(); } };
  $("#form-ev").onsubmit = e => {
    e.preventDefault();
    const text = $("#ev-text").value.trim(); if (!text) return;
    const kind = $("#ev-kind").value;
    const ev = { id: uid(), kind, source: $("#ev-source").value, text, added: Date.now(),
      signals: kind === "review" ? scanReview(text) : [], menu: kind === "menu" ? scanMenu(text) : null, ai: null };
    p.evidence.unshift(ev); save(); showPlace(id);
  };
  $("#ev-list").querySelectorAll("[data-act]").forEach(b => b.onclick = () => evidenceAction(p, b.dataset.ev, b.dataset.act, b));
}

function renderEvidence(ev) {
  const when = new Date(ev.added).toLocaleDateString();
  let body = "";
  if (ev.kind === "menu") {
    const lines = ev.menu.filter(l => l.status !== "plain");
    const label = { gf: "GF", ask: "ASK", risk: "RISK" };
    body = lines.length ? lines.map(l => `<div class="menu-line ${l.status}"><span class="tag">${label[l.status]}</span>${esc(l.line)}
      ${l.risks.length || l.friendly ? `<span class="why">${[...(l.friendly ? ["says \"gluten-friendly\", which usually means not celiac-safe"] : []), ...l.risks.map(r => `${r.word}: ${r.label}`)].map(esc).join(" · ")}</span>` : ""}</div>`).join("")
      : `<p class="muted small">Nothing on this menu stood out either way.</p>`;
  } else {
    const list = evSignals(ev);
    body = list.length ? list.map(x => `<div class="signal ${SIGNAL_INFO[x.key].good ? "good" : "bad"}"><div class="lab">${esc(SIGNAL_INFO[x.key].label)} <span class="muted small">· ${esc(x.by)}</span></div><q>“${esc(x.quote)}”</q></div>`).join("")
      : `<p class="muted small">No gluten-safety statements found.</p>`;
    if (ev.ai) body += `<p class="muted small">AI checked ${ev.ai.checked} sentence${ev.ai.checked === 1 ? "" : "s"} in ${ev.ai.seconds}s.</p>`;
  }
  return `<div class="card evidence" style="margin-top:0">
    <div class="src"><span><b>${esc(ev.source)}</b> · ${ev.kind === "menu" ? "menu" : "review"} · ${esc(when)}${ev.ai ? `<span class="ai-badge">AI READ</span>` : ""}</span></div>
    ${body}
    <details class="small"><summary class="muted">Show pasted text</summary><p>${esc(ev.text)}</p></details>
    <div class="row">
      ${ev.kind === "review" ? `<button data-act="ai" data-ev="${ev.id}">${ev.ai ? "Re-read with AI" : "Read with AI"}</button>` : ""}
      ${ev.ai ? `<button data-act="rules" data-ev="${ev.id}">Clear AI</button>` : ""}
      <button data-act="del" data-ev="${ev.id}">Remove</button>
    </div>
  </div>`;
}

async function evidenceAction(place, evId, act, btn) {
  const ev = place.evidence.find(e => e.id === evId); if (!ev) return;
  if (act === "del") { place.evidence = place.evidence.filter(e => e.id !== evId); save(); return showPlace(place.id); }
  if (act === "rules") { ev.ai = null; save(); return showPlace(place.id); }
  if (act === "ai") {
    if (!AI.ready()) { if (confirm("The AI model isn't loaded yet. Go to the AI tab to load it?")) showTab("ai"); return; }
    btn.disabled = true; btn.textContent = "Reading…";
    try {
      const t0 = performance.now();
      ev.ai = await AI.readReview(ev.text, (i, n) => btn.textContent = `Reading sentence ${i} of ${n}…`);
      ev.ai.model = AI.loadedModel(); ev.ai.seconds = Math.round((performance.now() - t0) / 100) / 10;
      save(); showPlace(place.id);
    } catch (e) { alert("AI read failed: " + e.message); btn.disabled = false; btn.textContent = "Read with AI"; }
  }
}

// ---------- AI tab ----------
$("#ai-model").innerHTML = AI.MODELS.map(m => `<option value="${m.key}">${esc(m.name)}</option>`).join("");
$("#ai-model").value = store.get("aiModel", "qwen35_2b");
AI.gpuSupport().then(g => {
  $("#ai-status").textContent = g.ok ? `WebGPU available${g.f16 ? "" : " (16-bit shaders not supported; using the 32-bit model build)"}. Not loaded.` : g.why;
  if (!g.ok) $("#btn-ai-load").disabled = true;
});
$("#btn-ai-load").onclick = async () => {
  const key = $("#ai-model").value; store.set("aiModel", key);
  const btn = $("#btn-ai-load"); btn.disabled = true; $(".bar").hidden = false;
  try {
    const id = await AI.load(key, (p, text) => { $("#ai-bar").style.width = Math.round(p * 100) + "%"; $("#ai-status").textContent = text; });
    $("#ai-status").textContent = `Ready: ${id}. Open a restaurant and tap "Read with AI" on a review.`;
    btn.textContent = "Switch model";
  } catch (e) { $("#ai-status").textContent = "Couldn't load: " + e.message; }
  btn.disabled = false;
};

// open straight to a barcode with ?code=
const qc = new URLSearchParams(location.search).get("code");
if (qc) lookup(qc);
