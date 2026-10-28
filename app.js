import * as R from './recognizer.js';

const FOODS = (window.FOODS || []).slice();
const byId = new Map(FOODS.map(f => [f.id, f]));
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = n => Math.round(n);
const fmt = n => r0(n).toLocaleString('ko-KR');

// ---------- 저장소 (폰 안에만 저장) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('hk:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hk:' + k, JSON.stringify(v)); return true; } catch { toast('저장 공간이 부족해요. 오래된 기록을 지워주세요.'); return false; } },
};
let profile = store.get('profile', null);
const isNum = v => typeof v === 'number' && isFinite(v);
function cleanLog(l) {
  if (!l || typeof l !== 'object' || !Array.isArray(l.items) || !/^\d{4}-\d{2}-\d{2}$/.test(l.date || '')) return null;
  const items = l.items.filter(i => i && typeof i.name === 'string').map(i => ({ id: String(i.id || ''), name: i.name.slice(0, 60), mult: isNum(i.mult) ? i.mult : 1,
    kcal: isNum(i.kcal) ? i.kcal : 0, c: isNum(i.c) ? i.c : 0, p: isNum(i.p) ? i.p : 0, f: isNum(i.f) ? i.f : 0, na: isNum(i.na) ? i.na : 0 }));
  return { id: String(l.id || 'm' + Math.random()).replace(/[^\w-]/g, ''), date: l.date, time: String(l.time || '').slice(0, 5), meal: String(l.meal || '식사').slice(0, 10),
    thumb: typeof l.thumb === 'string' && l.thumb.startsWith('data:image/') && !/["'<>]/.test(l.thumb) ? l.thumb : null,
    items, total: items.reduce((a, i) => a + i.kcal, 0) };
}
function cleanCustom(f) {
  if (!f || typeof f.name !== 'string' || !isNum(f.ingredients?.[0]?.kcal)) return null;
  const k = f.ingredients[0].kcal, name = f.name.slice(0, 40);
  return makeCustom(name, k, String(f.id || '').replace(/[^\w-]/g, '') || undefined);
}
function makeCustom(name, k, id) {
  return { id: id || 'custom_' + Date.now(), name, aliases: [], cat: '직접입력', serving: '1인분', grams: 0, custom: true,
    ingredients: [{ n: name, g: 0, kcal: k, t: 'main' }], macro: { c: k * 0.5 / 4, p: k * 0.2 / 4, f: k * 0.3 / 9 }, macroGuess: true, na: 0, lose: [], gain: [], alt: { lose: [], gain: [] }, recipe: null };
}
let logs = (store.get('logs', []) || []).map(cleanLog).filter(Boolean);
let customFoods = (store.get('custom', []) || []).map(cleanCustom).filter(Boolean);

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- 목표 계산 ----------
function calcPlan(p) {
  if (!p) return null;
  const bmr = p.sex === 'm' ? 10 * p.w + 6.25 * p.h - 5 * p.age + 5 : 10 * p.w + 6.25 * p.h - 5 * p.age - 161;
  const tdee = bmr * p.act;
  const daily = p.goal === 'keep' ? 0 : (p.rate * 7700) / 7;
  let target = p.goal === 'lose' ? tdee - daily : p.goal === 'gain' ? tdee + daily : tdee;
  const floor = Math.max(bmr, p.sex === 'm' ? 1500 : 1200);
  let capped = false;
  if (p.goal === 'lose' && target < floor) { target = Math.min(floor, tdee); capped = true; }
  // 단백질: 감량 1.6g/kg, 증량 1.8g/kg, 유지 1.2g/kg
  const prot = p.w * (p.goal === 'lose' ? 1.6 : p.goal === 'gain' ? 1.8 : 1.2);
  const fat = (target * 0.27) / 9;
  const carb = Math.max(0, (target - prot * 4 - fat * 9) / 4);
  const diff = p.t ? Math.abs(p.w - p.t) : 0;
  const realRate = p.goal === 'keep' ? 0 : Math.abs(target - tdee) * 7 / 7700;
  const weeks = realRate > 0.01 && diff ? Math.ceil(diff / realRate) : 0;
  return { bmr, tdee, target, prot, fat, carb, capped, weeks };
}
let plan = calcPlan(profile);
const goal = () => profile?.goal || 'keep';

// ---------- 화면 전환 ----------
const views = ['home', 'analyze', 'log', 'goal'];
function show(v) {
  views.forEach(x => $('#view-' + x).classList.toggle('hidden', x !== v));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#nav').classList.toggle('hidden', v === 'analyze');
  $('#saveBar').classList.toggle('hidden', v !== 'analyze');
  window.scrollTo(0, 0);
  if (v === 'analyze' && history.state?.v !== 'analyze') history.pushState({ v: 'analyze' }, '');
  if (v !== 'analyze' && history.state?.v === 'analyze') history.back();
  if (v === 'home') renderHome();
  if (v === 'log') renderLog();
  if (v === 'goal') renderGoal();
}
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v === 'camera') return $('#fileCam').click();
  show(b.dataset.v);
});
$('#backHome').onclick = () => show('home');
window.addEventListener('popstate', () => { if (!$('#view-analyze').classList.contains('hidden')) show('home'); });

// ---------- 홈 ----------
function todayTotals() {
  const t = { kcal: 0, c: 0, p: 0, f: 0, na: 0 };
  logs.filter(l => l.date === dayKey()).forEach(l => l.items.forEach(i => { t.kcal += i.kcal; t.c += i.c; t.p += i.p; t.f += i.f; t.na += i.na || 0; }));
  return t;
}
function renderHome() {
  const d = new Date();
  $('#todayLbl').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
  const t = todayTotals();
  const target = plan?.target || 2000;
  const ratio = Math.min(1, t.kcal / target);
  $('#ringArc').style.strokeDashoffset = 339.3 * (1 - ratio);
  $('#ringArc').style.stroke = t.kcal > target * 1.05 ? 'var(--warn)' : 'var(--accent)';
  $('#ringNum').textContent = fmt(t.kcal);
  const left = target - t.kcal;
  $('#ringSub').textContent = left >= 0 ? `${fmt(left)} kcal 남음` : `${fmt(-left)} kcal 초과`;
  const mt = plan ? { c: plan.carb, p: plan.prot, f: plan.fat } : { c: 300, p: 60, f: 55 };
  $('#macroBars').innerHTML = [['c', '탄수화물'], ['p', '단백질'], ['f', '지방']].map(([k, n]) => `
    <div class="mbar"><div class="lbl"><span>${n}</span><span>${r0(t[k])} / ${r0(mt[k])}g</span></div>
    <div class="track"><div class="fill" style="width:${Math.min(100, 100 * t[k] / mt[k])}%;background:var(--${k})"></div></div></div>`).join('')
    + `<div class="muted" style="font-size:12px">목표 ${fmt(target)} kcal${plan ? '' : ' (기본값 — 목표 탭에서 설정)'}</div>`;
  const todays = logs.filter(l => l.date === dayKey());
  $('#todayMeals').innerHTML = todays.length ? todays.map(mealRow).join('') : `<div class="empty">아직 기록이 없어요.<br>먹기 전에 사진부터 찍어보세요 📷</div>`;
  updatePill();
}
function mealRow(l) {
  return `<div class="meal">
    ${l.thumb ? `<img class="thumb" src="${esc(l.thumb)}" alt="">` : `<div class="thumb">🍽</div>`}
    <div class="grow"><div class="t">${esc(l.meal)} · ${esc(l.time)}</div><div class="muted">${esc(l.items.map(i => i.name + (i.mult !== 1 ? ` ×${i.mult}` : '')).join(', '))}</div></div>
    <div class="k">${fmt(l.total)} kcal</div><button class="x" data-del="${esc(l.id)}" aria-label="삭제">×</button></div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (!confirm('이 기록을 삭제할까요?')) return;
  logs = logs.filter(l => l.id !== b.dataset.del); store.set('logs', logs);
  renderHome(); if (!$('#view-log').classList.contains('hidden')) renderLog();
});
function updatePill() {
  const g = goal();
  $('#goalPill').textContent = profile ? `${{ lose: '감량', keep: '유지', gain: '증량' }[g]} · 하루 ${fmt(plan.target)}kcal` : '목표 설정 전';
}

// ---------- 사진 → 분석 ----------
let A = null; // 현재 분석 상태 { photoUrl, thumb, emb, items:[], cands }
function newAnalysis(photoUrl = null, thumb = null) {
  A = { photoUrl, thumb, emb: null, items: [], cands: null, auto: null, manual: [] };
  $('#photoCard').classList.toggle('hidden', !photoUrl);
  if (photoUrl) $('#photo').src = photoUrl;
  $('#candBox').classList.add('hidden');
  $('#aiStatus').innerHTML = '';
  $('#q').value = ''; $('#qres').innerHTML = '';
  const h = new Date().getHours();
  $('#mealType').value = h < 10 ? '아침' : h < 15 ? '점심' : h < 17 ? '간식' : h < 22 ? '저녁' : '간식';
  renderItems();
  show('analyze');
}
$('#btnCamera').onclick = () => $('#fileCam').click();
$('#btnAlbum').onclick = () => $('#fileAlbum').click();
$('#btnSearch').onclick = () => { newAnalysis(); setTimeout(() => $('#q').focus(), 50); };
$('#fileCam').onchange = e => onPhoto(e.target);
$('#fileAlbum').onchange = e => onPhoto(e.target);

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    // 일부 브라우저는 createImageBitmap 대신 <img>로만 열 수 있음
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
function resizeTo(src, max) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = r0(w * s); c.height = r0(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
async function onPhoto(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  let src;
  try { src = await loadBitmap(file); }
  catch { newAnalysis(); toast('이 사진은 읽을 수 없어요. 다른 사진을 고르거나 음식을 직접 찾아주세요.'); return; }
  const big = resizeTo(src, 1024);
  const small = resizeTo(big, 160);
  src.close?.();
  const thumb = small.toDataURL('image/jpeg', 0.7);
  const url = big.toDataURL('image/jpeg', 0.85);
  newAnalysis(url, thumb);
  const blob = await new Promise(r => big.toBlob(r, 'image/jpeg', 0.9));
  runAI(blob);
}

async function runAI(blob) {
  const myA = A;
  const st = $('#aiStatus');
  const setSt = (msg, pct) => {
    if (A !== myA) return;
    st.innerHTML = `<div class="status"><div class="spin"></div><div>${esc(msg)}</div></div>${pct != null ? `<div class="prog"><div style="width:${pct}%"></div></div>` : ''}`;
  };
  try {
    if (!R.isReady()) await R.load(FOODS, p => setSt(p.msg, p.pct));
    setSt('사진 분석 중…');
    const res = await R.classify(blob, FOODS, m => setSt(m));
    if (A !== myA) return; // 그 사이 다른 분석을 시작함
    A.emb = res.emb; A.cands = res;
    const top = res.main[0];
    st.innerHTML = `<div class="muted">🔒 폰 안에서 분석했어요 (사진 전송 없음)${R.hasHead() ? ' · 한식 전용 학습 적용' : ''}${R.personalCount() ? ` · 개인 학습 ${R.personalCount()}장` : ''}</div>`;
    renderCands();
    if (top && !A.items.length) { addItem(top.food.id, false); A.auto = top.food.id; }
  } catch (err) {
    console.error(err);
    if (A !== myA) return;
    st.innerHTML = `<div class="muted" style="color:var(--warn)">⚠️ 자동 인식을 쓸 수 없어요 (인터넷 연결이 필요한 첫 실행이거나 브라우저가 지원하지 않음). 아래에서 음식을 직접 찾아 추가해 주세요.</div>`;
  }
}
function renderCands() {
  if (!A.cands) return;
  const sel = new Set(A.items.map(i => i.id));
  const chip = (c, label) => `<button class="chip ${sel.has(c.food.id) ? 'on' : ''}" data-cand="${esc(c.food.id)}">${esc(c.food.name)} <span class="pct">${label}</span></button>`;
  let html = A.cands.main.map(c => chip(c, `${r0(c.p * 100)}%`)).join('');
  if (A.cands.extra.length) html += `<div class="muted" style="width:100%;margin-top:4px">사진 일부에서 발견 — 같이 있나요?</div>` + A.cands.extra.map(c => chip(c, '부분')).join('');
  $('#cands').innerHTML = html + `<div class="note" style="width:100%">목록에 없으면 아래에서 직접 찾아주세요. 고쳐주신 결과는 다음 인식에 반영돼요.</div>`;
  $('#candBox').classList.remove('hidden');
}
$('#cands').addEventListener('click', e => {
  const b = e.target.closest('[data-cand]'); if (!b) return;
  const id = b.dataset.cand;
  if (A.items.some(i => i.id === id)) removeItem(id); else { addItem(id); A.manual.push(id); }
});

// ---------- 검색 ----------
const normQ = s => s.replace(/\s+/g, '').toLowerCase();
function search(q) {
  q = normQ(q); if (!q) return [];
  const all = FOODS.concat(customFoods);
  return all.map(f => {
    const names = [f.name, ...(f.aliases || [])].map(normQ);
    let s = 0;
    for (const n of names) { if (n === q) s = Math.max(s, 100); else if (n.startsWith(q)) s = Math.max(s, 80); else if (n.includes(q)) s = Math.max(s, 60); else if (q.includes(n) && n.length > 1) s = Math.max(s, 40); }
    if (!s && normQ(f.cat || '').includes(q)) s = 20;
    return { f, s };
  }).filter(o => o.s).sort((a, b) => b.s - a.s).slice(0, 12).map(o => o.f);
}
$('#q').addEventListener('input', () => {
  const q = $('#q').value.trim();
  const res = search(q);
  $('#qres').innerHTML = res.map(f => `<div class="res" data-add="${esc(f.id)}"><span>${esc(f.name)} <span class="muted">${esc(f.serving)}</span></span><b>${fmt(baseKcal(f))} kcal</b></div>`).join('')
    + (q ? `<div class="res" data-custom="1"><span>➕ '${esc(q)}' 직접 입력하기</span><span class="muted">칼로리 입력</span></div>` : '');
});
$('#qres').addEventListener('click', e => {
  const a = e.target.closest('[data-add]');
  if (a) { addItem(a.dataset.add); A.manual.push(a.dataset.add); $('#q').value = ''; $('#qres').innerHTML = ''; return; }
  if (e.target.closest('[data-custom]')) {
    const name = $('#q').value.trim().slice(0, 40);
    const k = parseFloat(prompt(`'${name}' 1인분 칼로리(kcal)를 입력하세요`, '300'));
    if (!k || k <= 0 || k > 5000) return;
    let f = customFoods.find(c => c.name === name);
    if (f) { f.ingredients[0].kcal = k; Object.assign(f, makeCustom(name, k, f.id)); }
    else { f = makeCustom(name, k); customFoods.push(f); }
    store.set('custom', customFoods);
    addItem(f.id); $('#q').value = ''; $('#qres').innerHTML = '';
  }
});
const exactFood = name => { const q = normQ(name); return FOODS.find(f => [f.name, ...(f.aliases || [])].some(n => normQ(n) === q)); };
const getFood = id => byId.get(id) || customFoods.find(f => f.id === id);
const baseKcal = f => f.ingredients.reduce((s, i) => s + i.kcal, 0);

// ---------- 음식 항목 ----------
function addItem(id, scroll = true) {
  const f = getFood(id); if (!f) return;
  if (A.items.some(i => i.id === id)) return;
  A.items.push({ id, mult: 1, off: new Set(), tips: new Set(), tab: goal() === 'gain' ? 'gain' : 'lose' });
  renderItems(); renderCands();
  if (scroll) setTimeout(() => document.querySelector(`[data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
function removeItem(id) { A.items = A.items.filter(i => i.id !== id); renderItems(); renderCands(); }

function itemCalc(it) {
  const f = getFood(it.id);
  const full = baseKcal(f);
  let inc = 0, sauce = 0, sauceAll = 0;
  f.ingredients.forEach((g, k) => { if (g.t === 'sauce') sauceAll += g.kcal; if (!it.off.has(k)) { inc += g.kcal; if (g.t === 'sauce') sauce += g.kcal; } });
  let tipD = 0;
  it.tips.forEach(key => { const [s, k] = key.split(':'); const t = f[s]?.[+k]; if (t) tipD += t.d; });
  // 재료를 뺀 뒤 팁까지 적용해 과하게 빠지지 않도록, 줄이는 양은 남은 칼로리의 70%까지만
  if (tipD < -0.7 * inc) tipD = -0.7 * inc;
  const one = inc + tipD;
  const kcal = Math.max(0, one * it.mult);
  const ratio = full ? (one / full) : 1;           // 영양소는 칼로리 비율로 추정
  const naRatio = full ? (inc / full) : 1;
  const m = f.macro || { c: 0, p: 0, f: 0 };
  return { f, full: full * it.mult, kcal, sauce: sauce * it.mult, sauceAll: sauceAll * it.mult, c: m.c * ratio * it.mult, p: m.p * ratio * it.mult, fat: m.f * ratio * it.mult, na: (f.na || 0) * naRatio * it.mult, tipD: tipD * it.mult };
}

const PORTIONS = [[0.5, '반 인분'], [0.75, '적게'], [1, '1인분'], [1.25, '조금 많이'], [1.5, '1.5인분'], [2, '2인분']];
function renderItems() {
  const box = $('#items');
  if (!A || !A.items.length) { box.innerHTML = ''; renderTotal(); return; }
  box.innerHTML = A.items.map(it => {
    const c = itemCalc(it); const f = c.f;
    const ing = f.ingredients.map((g, k) => `
      <label class="ing ${it.off.has(k) ? 'off' : ''}">
        <input type="checkbox" data-ing="${esc(it.id)}:${k}" ${it.off.has(k) ? '' : 'checked'}>
        <span class="nm">${esc(g.n)} ${g.t === 'sauce' ? '<span class="tag sauce">양념</span>' : g.t === 'side' ? '<span class="tag side">부재료</span>' : ''}</span>
        <span class="g">${g.g ? r0(g.g * it.mult) + 'g' : ''}</span><span class="kc">${fmt(g.kcal * it.mult)}</span>
      </label>`).join('');
    const saucePct = c.full ? r0(100 * c.sauceAll / c.full) : 0;
    const tabs = f.custom ? '' : consultHtml(it, f);
    return `<div class="card" data-item="${esc(it.id)}">
      <div class="item-head"><div><div class="item-name">${esc(f.name)}</div><div class="muted">${esc(f.cat)} · ${esc(f.serving)}</div></div>
        <div style="text-align:right"><div class="kcal-big">${fmt(c.kcal)}<small> kcal</small></div><button class="btn small ghost" data-remove="${esc(it.id)}" style="margin-top:4px">빼기</button></div></div>
      <div class="portion">${PORTIONS.map(([v, l]) => `<button data-mult="${esc(it.id)}:${v}" class="${it.mult === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="range" class="slider" min="0.25" max="3" step="0.05" value="${it.mult}" data-slide="${esc(it.id)}" aria-label="양 조절">
      <div class="muted" style="font-size:12px">양: ${it.mult}배${f.grams ? ` (약 ${fmt(f.grams * it.mult)}g)` : ''} — 사진과 비교해 실제 먹을 양으로 맞춰주세요</div>
      ${f.custom ? '' : `<h3>재료별 칼로리 <span class="muted">— 안 먹는 재료는 체크 해제</span></h3>${ing}
      ${c.sauceAll ? `<div class="sauce-box">🧂 양념·소스·기름 칼로리 <b>${fmt(c.sauceAll)} kcal</b> (전체의 ${saucePct}%)${saucePct >= 25 ? ' — 숨은 칼로리가 커요. 양념을 덜면 효과가 커요.' : ''}</div>` : ''}`}
      <div class="macros"><div><b>${r0(c.c)}g</b><span>탄수화물</span></div><div><b>${r0(c.p)}g</b><span>단백질</span></div><div><b>${r0(c.fat)}g</b><span>지방</span></div><div><b>${fmt(c.na)}</b><span>나트륨mg</span></div></div>
      ${f.macroGuess || it.tips.size ? `<div class="note">영양소는 ${f.macroGuess ? '직접 입력한 칼로리 기준' : '조정한 칼로리 비율로'} 추정한 값이에요.</div>` : ''}
      ${tabs}
    </div>`;
  }).join('') + riceSuggestion();
  renderTotal();
}

function consultHtml(it, f) {
  const t = it.tab;
  const tabBtn = (v, l) => `<button data-tab="${esc(it.id)}:${v}" class="${t === v ? 'on' : ''}">${l}</button>`;
  let body = '';
  if (t === 'lose' || t === 'gain') {
    const tips = (f[t] || []).map((tp, k) => {
      const key = `${t}:${k}`;
      return `<label class="tip ${t} ${it.tips.has(key) ? 'applied' : ''}"> <input type="checkbox" data-tip="${esc(it.id)}:${key}" ${it.tips.has(key) ? 'checked' : ''}>
        <div class="grow"><div>${esc(tp.tip)}</div><div class="taste">맛: ${esc(tp.taste)}</div></div><div class="d">${tp.d > 0 ? '+' : ''}${fmt(tp.d * it.mult)}</div></label>`;
    }).join('');
    body = `<div class="muted" style="font-size:12px">하나를 고르면 위 칼로리에 바로 반영돼요</div>${tips}`;
  } else if (t === 'alt') {
    const sec = (s, title) => (f.alt?.[s] || []).length ? `<div class="muted" style="margin-top:6px;font-weight:700">${title}</div>` + f.alt[s].map(a => {
      const m = exactFood(a.name); const ok = m && m.id !== it.id && !A.items.some(x => x.id === m.id);
      return `<div class="alt"><div><div><b>${esc(a.name)}</b> · ${fmt(a.kcal)} kcal</div><div class="why">${esc(a.why)}</div></div>${ok ? `<button class="btn small ghost" data-swap="${esc(it.id)}:${esc(m.id)}">바꾸기 (${fmt(baseKcal(m))})</button>` : ''}</div>`;
    }).join('') : '';
    const order = goal() === 'gain' ? [['gain', '🔼 증량용 (비슷한 맛, 더 든든하게)'], ['lose', '🔽 감량용 (비슷한 맛, 더 가볍게)']] : [['lose', '🔽 감량용 (비슷한 맛, 더 가볍게)'], ['gain', '🔼 증량용 (비슷한 맛, 더 든든하게)']];
    body = order.map(([s, l]) => sec(s, l)).join('');
  } else if (t === 'recipe') {
    const r = f.recipe;
    body = r ? `<div class="recipe"><b>${esc(r.title)}</b> · <span style="color:var(--lose);font-weight:800">${fmt(r.kcal)} kcal</span> <span class="muted">(원래 ${fmt(baseKcal(f))} kcal)</span>
      <ul>${r.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul><ol>${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`
      : `<div class="muted">이미 가벼운 음식이라 별도 레시피가 없어요.</div>`;
  }
  return `<div class="tabs">${tabBtn('lose', '🔽 줄이기')}${tabBtn('gain', '🔼 늘리기')}${tabBtn('alt', '🔁 대체음식')}${tabBtn('recipe', '🍳 레시피')}</div>${body}`;
}

function riceSuggestion() {
  if (!A.items.length || A.items.some(i => /rice|bap/.test(i.id) || ['밥·죽', '면'].includes(getFood(i.id).cat))) return '';
  const needs = A.items.some(i => ['국·찌개', '고기·구이', '반찬'].includes(getFood(i.id).cat));
  const rice = FOODS.find(f => f.name === '공기밥' || f.id === 'rice' || f.id === 'steamed_rice' || f.id === 'white_rice');
  if (!needs || !rice) return '';
  return `<div class="addrice"><span>🍚 밥도 같이 드시나요? (${fmt(baseKcal(rice))} kcal)</span><button class="btn small primary" data-add-food="${rice.id}">공기밥 추가</button></div>`;
}

$('#items').addEventListener('click', e => {
  let b;
  if ((b = e.target.closest('[data-remove]'))) return removeItem(b.dataset.remove);
  if ((b = e.target.closest('[data-mult]'))) { const [id, v] = b.dataset.mult.split(':'); A.items.find(i => i.id === id).mult = +v; return renderItems(); }
  if ((b = e.target.closest('[data-tab]'))) { const [id, v] = b.dataset.tab.split(':'); A.items.find(i => i.id === id).tab = v; return renderItems(); }
  if ((b = e.target.closest('[data-add-food]'))) return addItem(b.dataset.addFood, false);
  if ((b = e.target.closest('[data-swap]'))) {
    const [from, to] = b.dataset.swap.split(':');
    if (A.items.some(i => i.id === to)) return toast('이미 추가된 음식이에요');
    const it = A.items.find(i => i.id === from);
    Object.assign(it, { id: to, off: new Set(), tips: new Set() });
    renderItems(); renderCands(); toast(`${getFood(to).name}(으)로 바꿨어요`);
  }
});
$('#items').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.ing) { const [id, k] = t.dataset.ing.split(':'); const it = A.items.find(i => i.id === id); t.checked ? it.off.delete(+k) : it.off.add(+k); renderItems(); }
  if (t.dataset.tip) {
    const [id, s, k] = t.dataset.tip.split(':'); const it = A.items.find(i => i.id === id); const key = `${s}:${k}`;
    // 같은 탭(줄이기/늘리기) 안의 팁은 서로 대안이라 하나만 선택
    [...it.tips].filter(x => x.startsWith(s + ':')).forEach(x => it.tips.delete(x));
    if (t.checked) it.tips.add(key);
    renderItems();
  }
});
$('#items').addEventListener('input', e => {
  const t = e.target; if (!t.dataset.slide) return;
  const it = A.items.find(i => i.id === t.dataset.slide); it.mult = +(+t.value).toFixed(2);
  const card = t.closest('.card'); const c = itemCalc(it);
  card.querySelector('.kcal-big').innerHTML = `${fmt(c.kcal)}<small> kcal</small>`;
  const lbl = t.nextElementSibling; if (lbl) lbl.firstChild.textContent = `양: ${it.mult}배${c.f.grams ? ` (약 ${fmt(c.f.grams * it.mult)}g)` : ''} — 사진과 비교해 실제 먹을 양으로 맞춰주세요`;
  renderTotal();
});
$('#items').addEventListener('change', e => { if (e.target.dataset.slide) renderItems(); });

// ---------- 합계 + 종합 컨설팅 ----------
function renderTotal() {
  const box = $('#totalBox');
  if (!A || !A.items.length) { box.innerHTML = ''; $('#btnSave').disabled = true; return; }
  $('#btnSave').disabled = false;
  const cs = A.items.map(itemCalc);
  const T = cs.reduce((a, c) => ({ kcal: a.kcal + c.kcal, full: a.full + c.full, sauce: a.sauce + c.sauce, c: a.c + c.c, p: a.p + c.p, f: a.f + c.fat, na: a.na + c.na }), { kcal: 0, full: 0, sauce: 0, c: 0, p: 0, f: 0, na: 0 });
  const target = plan?.target || 2000;
  const eaten = todayTotals().kcal;
  const after = eaten + T.kcal;
  const share = T.kcal / target;
  const g = goal();
  const v = [];
  const mealBudget = target / 3;
  if (g === 'lose') {
    if (T.kcal > mealBudget * 1.3) v.push(`한 끼 권장(약 ${fmt(mealBudget)}kcal)보다 ${fmt(T.kcal - mealBudget)}kcal 많아요. 각 음식의 '🔽 줄이기'를 체크하거나 양을 '적게'로 바꿔보세요.`);
    else v.push(`감량 목표에 맞는 한 끼예요 👍 (한 끼 권장 약 ${fmt(mealBudget)}kcal)`);
    if (T.p < (plan?.prot || 60) / 4) v.push(`단백질이 ${r0(T.p)}g으로 적어요. 감량 중엔 근육 유지를 위해 계란·두부·닭가슴살을 곁들이면 좋아요.`);
  } else if (g === 'gain') {
    if (T.kcal < mealBudget * 0.85) v.push(`증량 목표엔 조금 부족해요 (한 끼 권장 약 ${fmt(mealBudget)}kcal). '🔼 늘리기'에서 맛을 해치지 않는 추가 재료를 골라보세요.`);
    else v.push(`증량 목표에 맞게 충분히 드시는 한 끼예요 💪`);
    if (T.p < (plan?.prot || 100) / 4) v.push(`단백질 ${r0(T.p)}g — 증량은 근육으로 찌우는 게 좋아요. 고기·계란·우유를 추가해 보세요.`);
  } else {
    v.push(Math.abs(T.kcal - mealBudget) < mealBudget * 0.3 ? '유지 목표에 알맞은 한 끼예요.' : T.kcal > mealBudget ? '유지 기준으로 조금 많은 편이에요. 다음 끼니를 가볍게 하세요.' : '유지 기준으로 가벼운 한 끼예요.');
  }
  if (T.na > 2000) v.push(`나트륨 ${fmt(T.na)}mg — 하루 권장량(2,000mg)을 이 한 끼로 넘어요. 국물은 남기는 게 좋아요.`);
  if (T.kcal > 50 && T.sauce / T.kcal > 0.25) v.push(`칼로리의 ${Math.min(100, r0(100 * T.sauce / T.kcal))}%가 양념·소스·기름에서 와요. 소스를 따로 달라고 하거나 덜어 드세요.`);
  const saved = T.full - T.kcal;
  box.innerHTML = `<div class="card total-card">
    <div class="muted">이번 식사 총 칼로리</div>
    <div class="row between"><div class="total-num">${fmt(T.kcal)} kcal</div><div style="text-align:right" class="muted">하루 목표의 ${r0(share * 100)}%<br>먹으면 오늘 ${fmt(after)} / ${fmt(target)}</div></div>
    ${Math.abs(saved) >= 1 ? `<div class="muted">조정 전 ${fmt(T.full)} kcal → ${saved > 0 ? `${fmt(saved)} kcal 줄였어요` : `${fmt(-saved)} kcal 늘렸어요`}</div>` : ''}
    <div class="muted" style="margin-top:6px">탄 ${r0(T.c)}g · 단 ${r0(T.p)}g · 지 ${r0(T.f)}g · 나트륨 ${fmt(T.na)}mg</div>
    ${v.map(x => `<div class="verdict">${esc(x)}</div>`).join('')}
    ${!profile ? `<div class="verdict">🎯 목표 탭에서 키·체중·목표를 입력하면 나에게 맞춘 컨설팅을 받을 수 있어요.</div>` : ''}
  </div>`;
}

$('#btnSave').onclick = async () => {
  if (!A.items.length) return;
  const cs = A.items.map(it => ({ it, c: itemCalc(it) }));
  const now = new Date();
  const entry = {
    id: 'm' + now.getTime(), date: dayKey(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    meal: $('#mealType').value, thumb: A.thumb,
    items: cs.map(({ it, c }) => ({ id: it.id, name: c.f.name, mult: it.mult, kcal: r0(c.kcal), c: r0(c.c), p: r0(c.p), f: r0(c.fat), na: r0(c.na) })),
  };
  entry.total = entry.items.reduce((s, i) => s + i.kcal, 0);
  logs.push(entry);
  if (!store.set('logs', logs)) {
    entry.thumb = null;
    if (!store.set('logs', logs)) { logs.pop(); return toast('저장 공간이 부족해 기록하지 못했어요. 기록 탭에서 백업 후 오래된 기록을 지워주세요.'); }
  }
  // 개인 학습: 확실할 때만 — 자동 1순위를 그대로 두고 저장했거나, 1순위를 빼고 직접 고른 경우
  if (A.emb) {
    const ids = A.items.map(i => i.id).filter(id => byId.has(id));
    const manual = A.manual.filter(id => ids.includes(id) && id !== 'rice');
    let learnId = null;
    if (A.auto && ids.includes(A.auto) && !manual.length) learnId = A.auto;
    else if (A.auto && !ids.includes(A.auto) && manual.length) learnId = manual[0];
    if (learnId) R.learn(A.emb, [learnId]);
  }
  toast(`${entry.meal} ${fmt(entry.total)} kcal 기록했어요`);
  show('home');
};

// ---------- 기록 ----------
function renderLog() {
  const target = plan?.target || 2000;
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const sums = days.map(d => logs.filter(l => l.date === dayKey(d)).reduce((s, l) => s + l.total, 0));
  const max = Math.max(target * 1.2, ...sums);
  $('#week').innerHTML = `<div class="plot"><div class="goal" style="bottom:${(target / max) * 100}%"><span>목표</span></div>${days.map((d, i) => `<div class="col"><div class="v">${sums[i] ? fmt(sums[i]) : ''}</div><div class="bar ${sums[i] > target * 1.05 ? 'over' : ''}" style="height:${(sums[i] / max) * 100}%"></div></div>`).join('')}</div>
    <div class="days">${days.map((d, i) => `<div class="d">${i === 6 ? '오늘' : '일월화수목금토'[d.getDay()]}</div>`).join('')}</div>`;
  const logged = sums.filter(s => s > 0);
  const avg = logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : 0;
  const delta = plan && logged.length ? logged.reduce((s, v) => s + (v - plan.tdee), 0) / 7700 : 0;
  $('#weekStats').innerHTML = `<div><b>${fmt(avg)}</b><span>하루 평균 kcal</span></div><div><b>${logged.length}일</b><span>기록한 날</span></div>
    <div><b>${plan && logged.length ? (delta > 0 ? '+' : '') + delta.toFixed(2) + 'kg' : '-'}</b><span>예상 체중 변화</span></div>`;
  const byDay = {};
  logs.slice().reverse().forEach(l => (byDay[l.date] = byDay[l.date] || []).push(l));
  const keys = Object.keys(byDay).sort().reverse().slice(0, 30);
  $('#logDays').innerHTML = keys.length ? keys.map(k => `<div class="card"><div class="row between"><h2 style="margin:0">${esc(k.slice(5).replace('-', '월 '))}일</h2><b>${fmt(byDay[k].reduce((s, l) => s + l.total, 0))} kcal</b></div>${byDay[k].map(mealRow).join('')}</div>`).join('')
    : `<div class="card empty">기록이 쌓이면 여기에 보여요.</div>`;
}
$('#btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 1, profile, logs, customFoods }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `한끼코치-백업-${dayKey()}.json`; a.click();
};
$('#fileImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!Array.isArray(j.logs)) throw 0;
    const incoming = j.logs.map(cleanLog).filter(Boolean);
    if (!confirm(`기록 ${incoming.length}개를 불러올까요? 현재 기록과 합쳐집니다.`)) return;
    const ids = new Set(logs.map(l => l.id)); logs = logs.concat(incoming.filter(l => !ids.has(l.id))); store.set('logs', logs);
    const pr = j.profile;
    if (pr && !profile && ['lose', 'keep', 'gain'].includes(pr.goal) && [pr.age, pr.h, pr.w, pr.rate, pr.act].every(isNum)) {
      profile = { goal: pr.goal, sex: pr.sex === 'f' ? 'f' : 'm', age: pr.age, h: pr.h, w: pr.w, t: isNum(pr.t) ? pr.t : 0, rate: pr.rate, act: pr.act };
      store.set('profile', profile); plan = calcPlan(profile);
    }
    if (Array.isArray(j.customFoods)) {
      const have = new Set(customFoods.map(c => c.name));
      customFoods = customFoods.concat(j.customFoods.map(cleanCustom).filter(c => c && !have.has(c.name))); store.set('custom', customFoods);
    }
    toast('불러왔어요'); renderLog();
  } catch { toast('백업 파일을 읽을 수 없어요'); }
};

// ---------- 목표 ----------
let goalSel = profile?.goal || 'lose';
function renderGoal() {
  document.querySelectorAll('#goalSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === goalSel));
  if (profile && !renderGoal.filled) { renderGoal.filled = true; $('#pSex').value = profile.sex; $('#pAge').value = profile.age; $('#pH').value = profile.h; $('#pW').value = profile.w; $('#pT').value = profile.t || ''; $('#pRate').value = String(profile.rate); $('#pAct').value = String(profile.act); }
  $('#pT').closest('label').classList.toggle('hidden', goalSel === 'keep');
  $('#pRate').closest('label').classList.toggle('hidden', goalSel === 'keep');
  const gr = $('#goalResult');
  if (!plan) { gr.innerHTML = `<div class="muted">정보를 입력하고 저장하면 하루 권장 칼로리와 영양 목표를 계산해 드려요.</div>`; return; }
  const g = profile.goal;
  gr.innerHTML = `<h2>나의 하루 계획</h2>
    <div class="stat3"><div><b>${fmt(plan.bmr)}</b><span>기초대사량</span></div><div><b>${fmt(plan.tdee)}</b><span>하루 소비량</span></div><div><b style="color:var(--accent)">${fmt(plan.target)}</b><span>하루 목표 kcal</span></div></div>
    <div class="macros" style="grid-template-columns:repeat(3,1fr)"><div><b>${r0(plan.carb)}g</b><span>탄수화물</span></div><div><b>${r0(plan.prot)}g</b><span>단백질</span></div><div><b>${r0(plan.fat)}g</b><span>지방</span></div></div>
    <p class="muted" style="margin:10px 0 0">${g === 'lose' ? (plan.tdee - plan.target >= 1 ? `하루 약 ${fmt(plan.tdee - plan.target)}kcal 적게 먹는 계획이에요.` : '') : g === 'gain' ? `하루 약 ${fmt(plan.target - plan.tdee)}kcal 더 먹는 계획이에요. 근력운동을 함께하면 근육으로 늘어나요.` : '현재 체중을 유지하는 칼로리예요.'}
    ${plan.weeks ? ` 이 속도면 목표 체중까지 약 <b>${plan.weeks}주</b> 걸려요.` : ''}
    ${plan.capped ? `<br>⚠️ 건강을 위해 하루 ${fmt(Math.max(plan.bmr, profile.sex === 'm' ? 1500 : 1200))}kcal 아래로는 낮추지 않았어요.${plan.target >= plan.tdee - 1 ? ' 지금 활동량에서는 식사를 줄이기보다 활동량을 늘리는 게 안전한 감량 방법이에요.' : ' 더 빠른 감량은 운동량을 늘리는 게 안전해요.'}` : ''}</p>`;
}
$('#goalSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; goalSel = b.dataset.v; renderGoal(); });
$('#btnSaveGoal').onclick = () => {
  const p = { goal: goalSel, sex: $('#pSex').value, age: +$('#pAge').value, h: +$('#pH').value, w: +$('#pW').value, t: +$('#pT').value || 0, rate: +$('#pRate').value, act: +$('#pAct').value };
  if (!(p.age >= 14 && p.age <= 100 && p.h >= 120 && p.h <= 230 && p.w >= 30 && p.w <= 250)) return toast('나이·키·체중을 정확히 입력해 주세요');
  if (p.goal === 'lose' && p.t && p.t >= p.w) return toast('감량 목표 체중은 현재보다 낮아야 해요');
  if (p.goal === 'gain' && p.t && p.t <= p.w) return toast('증량 목표 체중은 현재보다 높아야 해요');
  profile = p; store.set('profile', p); plan = calcPlan(p);
  renderGoal(); updatePill(); toast('목표를 저장했어요');
};

// ---------- 테마 / 기타 ----------
const theme = store.get('theme', null);
if (theme) document.documentElement.dataset.theme = theme;
$('#btnTheme').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = nx; store.set('theme', nx);
};
$('#dbInfo').textContent = `음식 DB ${FOODS.length}종`;
$('#btnForget').onclick = async () => {
  if (!confirm('사진 인식 개인 학습 기록을 모두 지울까요? (식사 기록은 그대로 남아요)')) return;
  await R.forgetPersonal(); toast('개인 학습 기록을 지웠어요');
};

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
// 와이파이일 때만 모델을 미리 받아 두어 첫 촬영을 빠르게 (모바일 데이터 절약)
if (FOODS.length && navigator.connection?.type === 'wifi') setTimeout(() => R.load(FOODS).catch(() => {}), 2500);

window.__hk = { R, FOODS };
show('home');
