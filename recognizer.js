// 폰 안에서 동작하는 무료 음식 인식기 — 외부 AI API를 호출하지 않음 (사용료 0원)
// 3단 구조로 정확도를 끌어올림:
//  1) MobileCLIP zero-shot : 음식 설명 문장과 사진을 비교 (기본)
//  2) 한식 전용 학습 헤드 : AI Hub 한국 음식 이미지로 PC에서 학습한 분류기 (food-head.json, 있으면 사용)
//  3) 개인 학습          : 사용자가 확정한 사진을 기억해 다음부터 우선 인식 (폰에 저장)
// 모델 파일은 처음 한 번만 내려받고 브라우저 캐시에 저장됨.
export const TJS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
export const MODEL_ID = 'Xenova/mobileclip_s0';
const TEMPLATES = [
  t => `a photo of ${t}, a type of food.`,
  t => `a close-up photo of ${t} served on a table.`,
];
const PERSONAL_MAX = 600;

let lib = null, processor = null, visionModel = null;
let foodEmb = null;   // Float32Array[] 음식별 텍스트 임베딩
let head = null;      // { idx: foodIndex[], W: Float32Array[], b: number[] }
let personal = [];    // { id, e: Float32Array }
let loading = null;
let foodsRef = null;

// ---------- IndexedDB ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('hanki-coach', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function kvGet(k) { try { const db = await idb(); return await new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); } catch { return undefined; } }
export async function kvSet(k, v) { try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch {} }

export function hashFoods(foods) {
  let h = 2166136261; const s = MODEL_ID + TEMPLATES.length + foods.map(f => f.id + f.clip).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function norm(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function softmax(l) { const m = Math.max(...l); const e = l.map(x => Math.exp(x - m)); const z = e.reduce((a, b) => a + b, 0); return e.map(x => x / z); }

// 8비트 압축 임베딩(base64) 해제
export function decodeQ(j) {
  if (!j.q || !j.dim) return null;
  const bin = atob(j.q); const q = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
  const out = [];
  for (let i = 0; i < q.length / j.dim; i++) out.push(Array.from(norm(Array.from(q.subarray(i * j.dim, (i + 1) * j.dim), x => x / j.scale))));
  return out;
}
export function encodeQ(vecs, scale = 225) {
  const dim = vecs[0].length, q = new Int8Array(vecs.length * dim);
  vecs.forEach((v, i) => v.forEach((x, k) => { q[i * dim + k] = Math.max(-127, Math.min(127, Math.round(x * scale))); }));
  let s = ''; const u = new Uint8Array(q.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return { dim, scale, q: btoa(s) };
}
export function isReady() { return !!(visionModel && foodEmb); }
export function hasHead() { return !!head; }
export function personalCount() { return personal.length; }

export async function loadLib() {
  if (!lib) { lib = await import(TJS_URL); lib.env.allowLocalModels = false; }
  return lib;
}

export async function loadVision(cb) {
  await loadLib();
  if (!processor) processor = await lib.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: cb });
  if (!visionModel) visionModel = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32', progress_callback: cb });
}

const listeners = new Set();
let lastProgress = null;
export async function load(foods, cbIn = null) {
  if (isReady()) return;
  if (cbIn) { listeners.add(cbIn); if (lastProgress) cbIn(lastProgress); }
  const onProgress = p => { lastProgress = p; listeners.forEach(f => { try { f(p); } catch {} }); };
  if (loading) { try { return await loading; } finally { if (cbIn) listeners.delete(cbIn); } }
  foodsRef = foods;
  loading = (async () => {
    onProgress({ pct: 2, msg: '인식 엔진 불러오는 중…' });
    const files = {};
    const cb = p => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = [p.loaded, p.total];
        let a = 0, b = 0; for (const [l, t] of Object.values(files)) { a += l; b += t; }
        onProgress({ pct: 5 + Math.round(80 * a / b), msg: `AI 모델 내려받는 중 (처음 한 번만) ${(a / 1048576).toFixed(1)} / ${(b / 1048576).toFixed(1)}MB` });
      }
    };
    await loadVision(cb);

    // 텍스트 임베딩: 폰 캐시 → 미리 계산된 파일 → 직접 계산 순
    const hash = hashFoods(foods);
    const key = 'emb:' + hash;
    let cached = await kvGet(key);
    if (!cached) {
      try {
        const r = await fetch('food-emb.json', { cache: 'no-cache' });
        if (r.ok) { const j = await r.json(); if (j.hash === hash) cached = j.emb || decodeQ(j); }
      } catch {}
    }
    if (cached && cached.length === foods.length) {
      foodEmb = cached.map(a => Float32Array.from(a));
    } else {
      onProgress({ pct: 86, msg: '음식 목록 학습 중 (처음 한 번만)…' });
      foodEmb = await computeTextEmb(foods, cb, (pct) => onProgress({ pct: 86 + Math.round(12 * pct), msg: '음식 목록 학습 중 (처음 한 번만)…' }));
    }
    await kvSet(key, foodEmb.map(a => Array.from(a)));

    // 한식 전용 학습 헤드 (있을 때만)
    try {
      const r = await fetch('food-head.json', { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        if (j.model && j.model !== MODEL_ID) throw new Error('head model mismatch');
        if (!Array.isArray(j.W) || !j.W.length || j.W[0].length !== foodEmb[0].length) throw new Error('head dim mismatch');
        const pos = new Map(foods.map((f, i) => [f.id, i]));
        const keep = j.classes.map((id, k) => [pos.get(id), k]).filter(([i]) => i !== undefined);
        if (keep.length) head = { idx: keep.map(([i]) => i), W: keep.map(([, k]) => Float32Array.from(j.W[k])), b: keep.map(([, k]) => j.b[k] || 0), T: j.T || 1, mix: j.mix ?? 0.65 };
      }
    } catch {}

    // 개인 학습 데이터
    const ps = await kvGet('personal');
    if (Array.isArray(ps)) personal = ps.map(o => ({ id: o.id, e: Float32Array.from(o.e) }));
    onProgress({ pct: 100, msg: '준비 완료' });
  })();
  try { await loading; } finally { loading = null; lastProgress = null; if (cbIn) listeners.delete(cbIn); }
}

export async function computeTextEmb(foods, cb, onPct = () => {}) {
  await loadLib();
  const tokenizer = await lib.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: cb });
  const textModel = await lib.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8', progress_callback: cb });
  const texts = [];
  for (const f of foods) for (const t of TEMPLATES) texts.push(t(f.clip));
  const all = []; const B = 24;
  for (let i = 0; i < texts.length; i += B) {
    const inp = tokenizer(texts.slice(i, i + B), { padding: 'max_length', truncation: true });
    const { text_embeds } = await textModel(inp);
    all.push(...text_embeds.tolist());
    onPct(i / texts.length);
  }
  const out = [];
  for (let i = 0; i < foods.length; i++) {
    const vs = all.slice(i * TEMPLATES.length, (i + 1) * TEMPLATES.length).map(norm);
    const avg = new Float32Array(vs[0].length);
    for (const v of vs) for (let j = 0; j < v.length; j++) avg[j] += v[j];
    out.push(norm(avg));
  }
  return out;
}

export async function embedImage(blob) {
  const img = await lib.RawImage.fromBlob(blob);
  const inp = await processor(img);
  const { image_embeds } = await visionModel(inp);
  return norm(image_embeds.tolist()[0]);
}

// 세 가지 근거를 합쳐 음식별 확률을 계산
function score(e) {
  const n = foodEmb.length;
  let p = softmax(foodEmb.map(t => 100 * dot(t, e)));          // zero-shot
  if (head) {                                                  // 한식 전용 학습 헤드
    const hp = softmax(head.W.map((w, k) => (dot(w, e) + head.b[k]) / head.T));
    const q = new Array(n).fill(0);
    head.idx.forEach((i, k) => { q[i] = hp[k]; });
    // 두 분포의 혼합: 헤드가 학습한 음식에 확신하면 zero-shot의 오답을 뒤집을 수 있음
    const lam = head.mix;
    p = p.map((v, i) => (1 - lam) * v + lam * q[i]);
  }
  if (personal.length) {                                       // 개인 학습
    const pos = new Map(foodsRef.map((f, i) => [f.id, i]));
    const best = new Array(n).fill(-1);
    for (const o of personal) { const i = pos.get(o.id); if (i === undefined) continue; const s = dot(o.e, e); if (s > best[i]) best[i] = s; }
    const top = Math.max(...best);
    if (top > 0.8) {
      const pp = softmax(best.map(s => (s < 0 ? -1e9 : 60 * s)));
      const w = Math.min(0.85, (top - 0.8) * 6);  // 아주 비슷할수록 개인 기록을 더 믿음
      p = p.map((v, i) => (1 - w) * v + w * pp[i]);
    }
  }
  const z = p.reduce((a, b) => a + b, 0);
  return p.map(v => v / z);
}

function cropBlob(bitmap, sx, sy, sw, sh) {
  const c = document.createElement('canvas'); const S = 256;
  c.width = S; c.height = S;
  c.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, S, S);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

// 전체 사진 + 부분 영역(상차림의 여러 음식)을 분석
export async function classify(blob, foods, onProgress = () => {}) {
  const bitmap = await createImageBitmap(blob);
  const W = bitmap.width, H = bitmap.height;
  onProgress('사진 전체 분석 중…');
  const s = Math.min(W, H);
  const fullEmb = await embedImage(await cropBlob(bitmap, (W - s) / 2, (H - s) / 2, s, s));
  const full = score(fullEmb);
  const regions = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]].map(([x, y]) => [x * W, y * H, W / 2, H / 2]);
  const regionMax = new Array(foods.length).fill(0);
  const regionEmb = [];
  let k = 0;
  for (const r of regions) {
    k++; onProgress(`상차림 부분 분석 중… (${k}/${regions.length})`);
    const e = await embedImage(await cropBlob(bitmap, ...r));
    regionEmb.push(e);
    const p = score(e);
    const top = p.indexOf(Math.max(...p));
    if (p[top] > regionMax[top]) regionMax[top] = p[top];
  }
  const idx = foods.map((_, i) => i).sort((a, b) => full[b] - full[a]);
  const main = idx.slice(0, 6).map(i => ({ food: foods[i], p: full[i] }));
  const extra = regionMax.map((p, i) => ({ i, p })).filter(o => o.p > 0.3 && !main.some(m => m.food === foods[o.i]))
    .sort((a, b) => b.p - a.p).slice(0, 4).map(o => ({ food: foods[o.i], p: o.p }));
  return { main, extra, emb: Array.from(fullEmb) };
}

// 사용자가 확정한 음식을 기억 (개인 학습)
export async function learn(embArr, foodIds) {
  if (!embArr || !foodIds.length) return;
  const e = Float32Array.from(embArr);
  for (const id of foodIds.slice(0, 1)) personal.push({ id, e }); // 사진의 대표 음식 1개만
  if (personal.length > PERSONAL_MAX) personal = personal.slice(-PERSONAL_MAX);
  await kvSet('personal', personal.map(o => ({ id: o.id, e: Array.from(o.e, x => +x.toFixed(4)) })));
}
export async function forgetPersonal() { personal = []; await kvSet('personal', []); }

// 개발용: food-emb.json 생성
export async function exportEmbeddings(foods) {
  const emb = foodEmb && foodEmb.length === foods.length ? foodEmb : await computeTextEmb(foods);
  return JSON.stringify({ hash: hashFoods(foods), model: MODEL_ID, ...encodeQ(emb.map(a => Array.from(a))) });
}
