// FitCoach — personal trainer + nutricionista com IA (PWA, dados ficam só no seu iPhone)
const STORE_KEY = 'fitcoach.v1';
const SDK_URL = './vendor/anthropic-sdk-1.1.0.mjs';

/* ---------------- estado ---------------- */
const defaultState = () => ({
  profile: null, // {name, sex, age, height, startWeight, goal, pace, factor, eatback, startDate}
  adjust: 0,     // ajuste da meta base (kcal) aplicado pelo coach
  settings: { apiKey: '', model: 'claude-opus-5-5', theme: 'auto' },
  days: {},      // 'YYYY-MM-DD' -> {meals:[], acts:[], health:null}
  weights: [],   // [{date, kg}]
  coachLog: [],  // [{date, headline, adjust}]
});
let S = load();
let tab = S.profile ? 'hoje' : 'ajustes';
let viewDate = today();
let draft = null; // refeição em edição (antes de salvar)

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.warn(e); }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('Não consegui salvar (armazenamento cheio?). Exporte um backup.'); }
}
function day(d = viewDate) {
  if (!S.days[d]) S.days[d] = { meals: [], acts: [], health: null };
  return S.days[d];
}

/* ---------------- utilidades ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const fmt = (n) => r0(n).toLocaleString('pt-BR');
const uid = () => Math.random().toString(36).slice(2, 10);
function today() { return iso(new Date()); }
function iso(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
function prettyDate(dateStr) {
  if (dateStr === today()) return 'Hoje';
  if (dateStr === addDays(today(), -1)) return 'Ontem';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}
function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function num(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }

/* ---------------- cálculos ---------------- */
function currentWeight() {
  const w = [...S.weights].sort((a, b) => a.date.localeCompare(b.date));
  return w.length ? w[w.length - 1].kg : S.profile?.startWeight || 70;
}
function bmr(p = S.profile, w = currentWeight()) {
  // Mifflin-St Jeor
  return 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'f' ? -161 : 5);
}
function plan() {
  const p = S.profile;
  const B = bmr();
  const baseTdee = B * p.factor;
  const losing = p.goal < currentWeight();
  const gaining = p.goal > currentWeight();
  let delta = (p.pace * 7700) / 7; // kcal/dia
  delta = Math.min(delta, 1000);
  const floor = p.sex === 'f' ? 1200 : 1500;
  let base = baseTdee + (losing ? -delta : gaining ? delta : 0) + (S.adjust || 0);
  base = Math.max(base, floor);
  const w = currentWeight();
  const protein = r0((w > 0 && w / ((p.height / 100) ** 2) > 30 ? p.goal : w) * 1.8);
  const fat = r0(w * 0.8);
  return { B, baseTdee, base, delta, losing, gaining, floor, baseline: B * (p.factor - 1), protein, fat };
}
function dayTotals(d = viewDate) {
  const D = S.days[d] || { meals: [], acts: [], health: null };
  const eaten = D.meals.reduce((a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const manual = D.acts.reduce((a, x) => a + x.kcal, 0);
  const P = plan();
  const healthActive = D.health?.active ?? null;
  const activity = (healthActive != null ? healthActive : P.baseline) + manual;
  const extra = activity - P.baseline;
  const bonus = extra * S.profile.eatback;
  const target = Math.max(P.floor, P.base + bonus);
  const carbs = Math.max(0, r0((target - P.protein * 4 - P.fat * 9) / 4));
  return { eaten, manual, activity, extra, bonus, target, remaining: target - eaten.kcal, macroTarget: { p: P.protein, c: carbs, f: P.fat }, D, P };
}
const METS = [
  ['Musculação', 5], ['Caminhada leve', 3.3], ['Caminhada rápida', 4.5], ['Corrida (8 km/h)', 8.3], ['Corrida (10 km/h)', 9.8],
  ['Bicicleta moderada', 7], ['Spinning', 8.5], ['Natação', 7], ['Funcional / HIIT', 8], ['Futebol', 7], ['Beach tennis', 6],
  ['Yoga / Pilates', 3], ['Dança', 5.5], ['Elíptico', 5], ['Escada', 9], ['Tênis', 7.3],
];
function regression(points) { // [{x, y}]
  const n = points.length; if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n, my = points.reduce((a, p) => a + p.y, 0) / n;
  let num_ = 0, den = 0; for (const p of points) { num_ += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (!den) return null;
  const slope = num_ / den; return { slope, intercept: my - slope * mx };
}
function weightTrend(daysBack = 21) {
  const from = addDays(today(), -daysBack);
  const pts = S.weights.filter((w) => w.date >= from).map((w) => ({ x: (new Date(w.date) - new Date(from)) / 864e5, y: w.kg }));
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  if (span < 7) return null;
  const reg = regression(pts); if (!reg) return null;
  return { perWeek: reg.slope * 7, n: pts.length, span };
}
function adaptiveSuggestion() {
  const t = weightTrend(21); if (!t) return null;
  const P = plan(); const p = S.profile;
  const logged = []; for (let i = 1; i <= 14; i++) { const d = S.days[addDays(today(), -i)]; if (d && d.meals.length) logged.push(d); }
  const adherence = logged.length / 14;
  const planned = P.losing ? -p.pace : P.gaining ? p.pace : 0; // kg/sem
  const diff = t.perWeek - planned; // >0 = está perdendo menos (ou ganhando mais) que o planejado
  let change = -(diff * 7700) / 7;
  change = Math.max(-300, Math.min(300, Math.round(change / 50) * 50));
  return { trend: t.perWeek, planned, adherence, change };
}

/* ---------------- imagens ---------------- */
function fileToImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = rej; img.src = url;
  });
}
function imageToJpeg(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function prepPhotos(files) {
  const out = [];
  for (const f of files) {
    const img = await fileToImage(f);
    out.push({ full: imageToJpeg(img, 1280, 0.82), thumb: imageToJpeg(img, 120, 0.7) });
  }
  return out;
}
const b64 = (dataUrl) => dataUrl.split(',')[1];

/* ---------------- Claude ---------------- */
let AnthropicCtor = null;
async function claudeJSON({ system, content, schema, effort = 'medium' }) {
  const key = S.settings.apiKey?.trim();
  if (!key) throw new Error('Configure sua chave da API do Claude em Ajustes.');
  if (!AnthropicCtor) AnthropicCtor = (await import(SDK_URL)).default;
  const client = new AnthropicCtor({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = S.settings.model || 'claude-opus-5-5';
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  if (!model.startsWith('claude-haiku')) { // fallback do servidor em caso de recusa
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let resp;
  try {
    resp = await client.beta.messages.create(params);
  } catch (e) {
    if (e instanceof AnthropicCtor.AuthenticationError) throw new Error('Chave da API inválida. Confira em Ajustes.');
    if (e instanceof AnthropicCtor.RateLimitError) throw new Error('Limite de uso atingido. Tente de novo em instantes.');
    if (e instanceof AnthropicCtor.APIConnectionError) throw new Error('Sem conexão com a IA. Verifique a internet.');
    if (e instanceof AnthropicCtor.APIError) throw new Error(`Erro da IA (${e.status ?? '?'}): ${e.message}`);
    throw e;
  }
  if (resp.stop_reason === 'refusal') throw new Error('A IA não conseguiu analisar este pedido. Tente descrever em texto.');
  if (resp.stop_reason === 'max_tokens') throw new Error('Resposta cortada. Tente de novo.');
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}
const ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'portion', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
  properties: {
    name: { type: 'string' }, portion: { type: 'string' },
    kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
  },
};
const MEAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['meal_name', 'items', 'confidence', 'notes'],
  properties: {
    meal_name: { type: 'string' },
    items: { type: 'array', items: ITEM_SCHEMA },
    confidence: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    notes: { type: 'string' },
  },
};
const MEAL_SYSTEM = `Você é um nutricionista brasileiro experiente em estimar refeições a partir de fotos e descrições.
Identifique cada alimento separadamente, estime a porção em gramas/ml e em medida caseira (ex.: "120 g · 4 colheres de sopa"),
usando referências visuais da foto (prato raso ~26 cm, talheres, copo, mão). Calcule kcal e macros com base na Tabela TACO
e, na falta dela, na USDA. Inclua óleo/manteiga de preparo e molhos visíveis como itens próprios quando relevantes.
Seja realista, sem subestimar porções. Se o usuário informar algo na observação (quantidade, ingrediente), isso prevalece sobre a foto.
Em "notes", diga em 1–2 frases curtas o que deixou a estimativa incerta e uma dica rápida, se fizer sentido. Tudo em português do Brasil.`;

async function analyzeMeal(photos, note) {
  const content = [];
  for (const ph of photos) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(ph.full) } });
  content.push({ type: 'text', text: (photos.length ? 'Analise a refeição da(s) foto(s).' : 'Analise a refeição descrita.') + (note ? `\nObservação do usuário: ${note}` : '') });
  return claudeJSON({ system: MEAL_SYSTEM, content, schema: MEAL_SCHEMA, effort: 'medium' });
}

const CRAVING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'desired_item', 'desired_kcal', 'recommended_portion', 'message', 'alternatives'],
  properties: {
    verdict: { type: 'string', enum: ['pode', 'porcao_menor', 'melhor_nao'] },
    desired_item: { type: 'string' },
    desired_kcal: { type: 'number' },
    recommended_portion: { type: 'string' },
    message: { type: 'string' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'kcal', 'how_to'],
        properties: { name: { type: 'string' }, kcal: { type: 'number' }, how_to: { type: 'string' } },
      },
    },
  },
};
const CRAVING_SYSTEM = `Você é o nutricionista e personal trainer do usuário, direto e acolhedor, falando português do Brasil.
O usuário está com vontade de comer um doce. Você recebe o saldo calórico do dia e as metas.
Regras: 1) estime as kcal da porção típica do que ele quer; 2) "pode" se cabe no saldo restante deixando margem para as próximas
refeições previstas do dia; "porcao_menor" se uma porção reduzida cabe (diga exatamente qual, ex.: "2 quadradinhos / 20 g");
"melhor_nao" se não cabe ou se já estourou a meta. 3) Sempre sugira 2–3 alternativas mais saudáveis e práticas, de preferência
fáceis de achar no Brasil, com kcal e modo de preparo em uma frase, que caibam no saldo. 4) "message": 2–3 frases, sem sermão,
considerando o horário e o que ainda falta comer no dia. Nunca recomende ficar abaixo de comer as refeições principais.`;

const COACH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'analysis', 'suggested_adjust_kcal', 'tips', 'workout_plan'],
  properties: {
    headline: { type: 'string' },
    analysis: { type: 'string' },
    suggested_adjust_kcal: { type: 'integer' },
    tips: { type: 'array', items: { type: 'string' } },
    workout_plan: { type: 'string' },
  },
};
const COACH_SYSTEM = `Você é um nutricionista esportivo e personal trainer revisando as últimas 2 semanas do seu aluno.
Analise ingestão x meta, regularidade dos registros, proteína, atividade física e a tendência do peso (use a tendência, não oscilações diárias).
"suggested_adjust_kcal": mudança na meta calórica diária base em relação à atual (negativo = comer menos), múltiplo de 50,
entre -300 e +300; use 0 se os dados forem insuficientes ou se o ritmo estiver adequado. Nunca leve a meta abaixo do piso informado.
"analysis": 3–5 frases objetivas. "tips": 3 dicas práticas e específicas para a próxima semana.
"workout_plan": sugestão de treino semanal curta (dias, tipo, duração) coerente com o histórico. Português do Brasil.`;

/* ---------------- render ---------------- */
const app = document.getElementById('app');
function render() {
  if (S.settings.theme === 'light' || S.settings.theme === 'dark') document.documentElement.dataset.theme = S.settings.theme;
  else delete document.documentElement.dataset.theme;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#tabs').classList.toggle('hidden', !S.profile);
  ({ hoje: renderHoje, registrar: renderRegistrar, atividade: renderAtividade, doce: renderDoce, progresso: renderProgresso, ajustes: renderAjustes })[tab]();
  window.scrollTo(0, 0);
}
function go(t) { tab = t; render(); }
$$('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

function header(title, sub, extra = '') {
  return `<div class="row between"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${extra}</div>`;
}
function dateNav() {
  return `<div class="row" style="gap:4px">
    <button class="btn-2" style="min-height:36px;padding:6px 12px" data-nav="-1" aria-label="Dia anterior">‹</button>
    <button class="btn-2" style="min-height:36px;padding:6px 12px" data-nav="1" aria-label="Próximo dia" ${viewDate >= today() ? 'disabled' : ''}>›</button>
    <button class="btn-2" style="min-height:36px;padding:6px 10px" data-go="ajustes" aria-label="Ajustes">⚙︎</button>
  </div>`;
}
function bindCommon() {
  $$('[data-nav]').forEach((b) => b.onclick = () => { viewDate = addDays(viewDate, +b.dataset.nav); if (viewDate > today()) viewDate = today(); render(); });
  $$('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
}
function ring(pct, label, value, color = 'var(--accent)') {
  const R = 56, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, pct));
  return `<div class="ring"><svg width="132" height="132" viewBox="0 0 132 132">
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>
    <div class="center"><b class="num">${value}</b><span>${label}</span></div></div>`;
}
function macroBar(name, val, target, color) {
  const pct = target ? Math.min(100, (val / target) * 100) : 0;
  return `<div class="macro"><div class="muted">${name}</div><b class="num">${r0(val)}</b><span class="tiny"> / ${r0(target)} g</span>
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}
const MEAL_ICONS = { 'Café da manhã': '☕️', 'Almoço': '🍽️', 'Lanche': '🥪', 'Jantar': '🌙', 'Ceia': '🫖', 'Doce': '🍫' };
function mealTypeByHour(h = new Date().getHours()) {
  if (h < 10) return 'Café da manhã'; if (h < 15) return 'Almoço'; if (h < 18) return 'Lanche'; if (h < 22) return 'Jantar'; return 'Ceia';
}

/* ----- HOJE ----- */
function renderHoje() {
  const T = dayTotals();
  const over = T.remaining < 0;
  const color = over ? 'var(--bad)' : T.remaining < 200 ? 'var(--warn)' : 'var(--accent)';
  const meals = T.D.meals;
  const sug = viewDate === today() ? adaptiveSuggestion() : null;
  app.innerHTML = `
    ${header(prettyDate(viewDate), new Date(viewDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }), dateNav())}
    <div class="card">
      <div class="ringwrap">
        ${ring(T.eaten.kcal / T.target, over ? 'acima' : 'restam', fmt(Math.abs(T.remaining)), color)}
        <dl class="eq num">
          <dt>Meta base</dt><dd>${fmt(T.P.base)}</dd>
          <dt>Exercício ${T.D.health ? '' : '(est.)'}</dt><dd>${T.bonus >= 0 ? '+' : '−'}${fmt(Math.abs(T.bonus))}</dd>
          <dt class="tot">Meta do dia</dt><dd class="tot">${fmt(T.target)}</dd>
          <dt>Consumido</dt><dd>−${fmt(T.eaten.kcal)}</dd>
        </dl>
      </div>
      <div class="grid3" style="margin-top:14px">
        ${macroBar('Proteína', T.eaten.p, T.macroTarget.p, 'var(--blue)')}
        ${macroBar('Carbo', T.eaten.c, T.macroTarget.c, 'var(--warn)')}
        ${macroBar('Gordura', T.eaten.f, T.macroTarget.f, 'var(--bad)')}
      </div>
    </div>

    <div class="grid2" style="margin-top:14px">
      <button class="full" data-go="registrar">📷 Registrar refeição</button>
      <button class="btn-2 full" data-go="doce">🍫 Vontade de doce</button>
    </div>

    <div class="card">
      <div class="row between"><h2>Refeições</h2><span class="tiny num">${fmt(T.eaten.kcal)} kcal</span></div>
      ${meals.length ? `<ul class="list">${meals.map((m) => `
        <li>
          ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="">` : `<div class="thumb">${MEAL_ICONS[m.type] || '🍴'}</div>`}
          <div class="grow"><div class="name">${esc(m.name)}</div>
            <div class="tiny">${esc(m.type)} · ${esc(m.time)} · P ${r0(m.p)} · C ${r0(m.c)} · G ${r0(m.f)}</div></div>
          <b class="num">${fmt(m.kcal)}</b>
          <button class="x" data-del-meal="${m.id}" aria-label="Apagar">×</button>
        </li>`).join('')}</ul>` : `<p class="sub">Nada registrado ainda. Tire uma foto do prato ou descreva o que comeu.</p>`}
    </div>

    <div class="card">
      <div class="row between"><h2>Atividade</h2><button class="btn-ghost" data-go="atividade">Detalhes</button></div>
      <div class="grid3 num">
        <div><div class="tiny">Gasto ativo</div><b>${fmt(T.activity)}</b> <span class="tiny">kcal</span></div>
        <div><div class="tiny">Passos</div><b>${T.D.health?.steps != null ? fmt(T.D.health.steps) : '—'}</b></div>
        <div><div class="tiny">Treinos</div><b>${T.D.acts.length}</b></div>
      </div>
      ${!T.D.health ? `<p class="tiny" style="margin-top:8px">Sem dados do app Saúde hoje — usando estimativa do seu nível de atividade.</p>` : ''}
    </div>

    ${sug && Math.abs(sug.change) >= 50 && sug.adherence >= 0.6 ? `
      <div class="callout"><b>Ajuste sugerido:</b> seu peso está variando ${sug.trend > 0 ? '+' : ''}${r1(sug.trend)} kg/sem (plano: ${sug.planned > 0 ? '+' : ''}${r1(sug.planned)}).
      Sugiro ${sug.change > 0 ? 'aumentar' : 'reduzir'} a meta em ${Math.abs(sug.change)} kcal/dia.
      <div style="margin-top:8px"><button class="btn-ghost" data-go="progresso">Ver no Progresso ›</button></div></div>` : ''}
  `;
  bindCommon();
  $$('[data-del-meal]').forEach((b) => b.onclick = () => {
    if (!confirm('Apagar esta refeição?')) return;
    const D = day(); D.meals = D.meals.filter((m) => m.id !== b.dataset.delMeal); save(); render();
  });
}

/* ----- REGISTRAR ----- */
let regMode = 'foto';
let regPhotos = [];
function renderRegistrar() {
  if (draft) return renderDraft();
  const T = dayTotals();
  app.innerHTML = `
    ${header('Registrar', `${prettyDate(viewDate)} · restam ${fmt(Math.max(0, T.remaining))} kcal`)}
    <div class="card">
      <div class="seg" id="seg">
        <button data-m="foto" class="${regMode === 'foto' ? 'on' : ''}">📷 Foto</button>
        <button data-m="texto" class="${regMode === 'texto' ? 'on' : ''}">✍️ Texto</button>
        <button data-m="manual" class="${regMode === 'manual' ? 'on' : ''}">🔢 Manual</button>
      </div>

      <div class="${regMode === 'foto' ? '' : 'hidden'}" style="margin-top:14px">
        <label class="photo-drop" for="ph">
          <span class="ico">📸</span><b>Tirar foto ou escolher da galeria</b>
          <span class="tiny">Dica: fotografe de cima, com o prato inteiro e um talher visível.</span>
        </label>
        <input id="ph" type="file" accept="image/*" multiple class="hidden">
        <div class="previews" id="prev">${regPhotos.map((p) => `<img src="${p.thumb}" alt="">`).join('')}</div>
        <label for="note">Observação (opcional)</label>
        <input id="note" placeholder="ex.: arroz integral, frango grelhado sem óleo, suco sem açúcar">
      </div>

      <div class="${regMode === 'texto' ? '' : 'hidden'}" style="margin-top:14px">
        <label for="desc">O que você comeu?</label>
        <textarea id="desc" placeholder="ex.: 2 ovos mexidos, 1 pão francês com requeijão e café com leite"></textarea>
      </div>

      <div class="${regMode === 'manual' ? '' : 'hidden'}" style="margin-top:14px">
        <label for="mn">Nome</label><input id="mn" placeholder="ex.: Barra de proteína">
        <div class="grid2">
          <div><label for="mk">kcal</label><input id="mk" inputmode="decimal"></div>
          <div><label for="mp">Proteína (g)</label><input id="mp" inputmode="decimal"></div>
          <div><label for="mc">Carbo (g)</label><input id="mc" inputmode="decimal"></div>
          <div><label for="mf">Gordura (g)</label><input id="mf" inputmode="decimal"></div>
        </div>
      </div>

      <button class="full" id="go" style="margin-top:16px">${regMode === 'manual' ? 'Continuar' : '✨ Calcular calorias com IA'}</button>
      ${!S.settings.apiKey && regMode !== 'manual' ? `<p class="tiny" style="margin-top:8px">Para usar a IA, adicione sua chave da API em <a href="#" data-go="ajustes">Ajustes</a>.</p>` : ''}
    </div>
  `;
  bindCommon();
  $$('#seg button').forEach((b) => b.onclick = () => { regMode = b.dataset.m; render(); });
  $('#ph').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    try { regPhotos = regPhotos.concat(await prepPhotos(files)).slice(-4); }
    catch { toast('Não consegui abrir essa imagem.'); }
    $('#prev').innerHTML = regPhotos.map((p) => `<img src="${p.thumb}" alt="">`).join('');
  };
  $('#go').onclick = async (ev) => {
    const btn = ev.currentTarget;
    if (regMode === 'manual') {
      const kcal = num($('#mk').value); if (!kcal) return toast('Informe as calorias.');
      draft = { type: mealTypeByHour(), name: $('#mn').value || 'Refeição', thumb: null, confidence: null, notes: '',
        items: [{ name: $('#mn').value || 'Item', portion: '', kcal, protein_g: num($('#mp').value), carbs_g: num($('#mc').value), fat_g: num($('#mf').value) }] };
      return render();
    }
    const note = regMode === 'foto' ? $('#note').value.trim() : $('#desc').value.trim();
    const photos = regMode === 'foto' ? regPhotos : [];
    if (regMode === 'foto' && !photos.length) return toast('Adicione ao menos uma foto.');
    if (regMode === 'texto' && !note) return toast('Descreva o que comeu.');
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Analisando…`;
    try {
      const r = await analyzeMeal(photos, note);
      draft = { type: mealTypeByHour(), name: r.meal_name, thumb: photos[0]?.thumb || null, confidence: r.confidence, notes: r.notes, items: r.items };
      regPhotos = [];
      render();
    } catch (e) {
      toast(e.message || String(e), 4500);
      btn.disabled = false; btn.textContent = '✨ Calcular calorias com IA';
    }
  };
}
function draftTotals() {
  return draft.items.reduce((a, i) => ({ kcal: a.kcal + num(i.kcal), p: a.p + num(i.protein_g), c: a.c + num(i.carbs_g), f: a.f + num(i.fat_g) }), { kcal: 0, p: 0, c: 0, f: 0 });
}
function renderDraft() {
  const t = draftTotals();
  const T = dayTotals();
  const after = T.remaining - t.kcal;
  const conf = { alta: ['', 'confiança alta'], media: ['warn', 'confiança média'], baixa: ['bad', 'confiança baixa'] }[draft.confidence];
  app.innerHTML = `
    ${header('Confira', 'Ajuste as quantidades se precisar')}
    <div class="card">
      <div class="row">
        ${draft.thumb ? `<img class="thumb" src="${draft.thumb}" alt="" style="width:64px;height:64px">` : ''}
        <div class="grow" style="flex:1">
          <input id="dn" value="${esc(draft.name)}" aria-label="Nome da refeição">
          ${conf ? `<div style="margin-top:6px"><span class="pill ${conf[0]}">${conf[1]}</span></div>` : ''}
        </div>
      </div>
      <label for="dt">Refeição</label>
      <select id="dt">${Object.keys(MEAL_ICONS).map((k) => `<option ${k === draft.type ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <table class="items">
        <thead><tr><th>Item</th><th class="r">kcal</th><th class="r">P/C/G</th><th></th></tr></thead>
        <tbody>${draft.items.map((i, ix) => `
          <tr><td><div style="font-weight:600">${esc(i.name)}</div><div class="tiny">${esc(i.portion)}</div></td>
            <td class="r"><input class="n" data-k="${ix}" inputmode="decimal" value="${r0(i.kcal)}"></td>
            <td class="r tiny num">${r0(i.protein_g)}/${r0(i.carbs_g)}/${r0(i.fat_g)}</td>
            <td><button class="x" data-rm="${ix}" aria-label="Remover">×</button></td></tr>`).join('')}
        </tbody>
      </table>
      <div class="row between" style="margin-top:12px"><b>Total</b><b class="num">${fmt(t.kcal)} kcal</b></div>
      <div class="tiny num">Proteína ${r0(t.p)} g · Carbo ${r0(t.c)} g · Gordura ${r0(t.f)} g</div>
      ${draft.notes ? `<div class="callout">${esc(draft.notes)}</div>` : ''}
      <div class="callout" style="background:${after < 0 ? 'var(--bad-soft)' : 'var(--accent-soft)'}">
        Depois desta refeição: <b style="color:${after < 0 ? 'var(--bad)' : 'var(--accent)'}">${after < 0 ? `${fmt(-after)} kcal acima da meta` : `restam ${fmt(after)} kcal`}</b>
      </div>
      <div class="grid2" style="margin-top:14px">
        <button class="btn-2" id="cancel">Descartar</button>
        <button id="save">Salvar</button>
      </div>
    </div>`;
  $$('[data-k]').forEach((inp) => inp.onchange = () => {
    const i = draft.items[+inp.dataset.k]; const old = num(i.kcal) || 1; const nw = num(inp.value);
    const f = nw / old; // escala macros proporcionalmente
    i.kcal = nw; i.protein_g *= f; i.carbs_g *= f; i.fat_g *= f; draft.name = $('#dn').value; draft.type = $('#dt').value; render();
  });
  $$('[data-rm]').forEach((b) => b.onclick = () => { draft.items.splice(+b.dataset.rm, 1); draft.name = $('#dn').value; draft.type = $('#dt').value; render(); });
  $('#cancel').onclick = () => { draft = null; render(); };
  $('#save').onclick = () => {
    const tt = draftTotals();
    day().meals.push({ id: uid(), type: $('#dt').value, name: $('#dn').value || 'Refeição', time: new Date().toTimeString().slice(0, 5),
      kcal: r0(tt.kcal), p: r1(tt.p), c: r1(tt.c), f: r1(tt.f), thumb: draft.thumb, items: draft.items });
    save(); draft = null; toast('Refeição salva ✅'); go('hoje');
  };
}

/* ----- ATIVIDADE ----- */
function healthNum(raw) {
  let t = String(raw).trim();
  if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 9.400 passos
  const n = parseFloat(t); return isFinite(n) ? n : null;
}
function parseHealth(text) {
  const s = String(text || '');
  const pick = (keys) => {
    for (const k of keys) { const m = s.match(new RegExp(`${k}\\s*[=:]\\s*([\\d.,]+)`, 'i')); if (m) { const v = healthNum(m[1]); if (v != null) return v; } }
    return null;
  };
  const dm = s.match(/date\s*[=:]\s*(\d{4}-\d{2}-\d{2})/i);
  return {
    active: pick(['active', 'ativa', 'energia']), steps: pick(['steps', 'passos']),
    weight: pick(['weight', 'peso']), exercise: pick(['exercise', 'exercicio', 'exercício']),
    date: dm ? dm[1] : null,
  };
}
function applyHealth(h, fallbackDate = today()) {
  if (h.active == null && h.steps == null && h.weight == null) return false;
  const d = h.date || fallbackDate;
  const D = day(d);
  D.health = { active: h.active != null ? r0(h.active) : D.health?.active ?? null, steps: h.steps != null ? r0(h.steps) : D.health?.steps ?? null,
    exercise: h.exercise != null ? r0(h.exercise) : null, ts: Date.now() };
  if (h.weight && h.weight > 25 && h.weight < 400) addWeight(d, h.weight);
  save();
  return true;
}
function addWeight(date, kg) {
  S.weights = S.weights.filter((w) => w.date !== date);
  S.weights.push({ date, kg: r1(kg) });
  S.weights.sort((a, b) => a.date.localeCompare(b.date));
}
function renderAtividade() {
  const T = dayTotals();
  const D = T.D;
  app.innerHTML = `
    ${header('Atividade', prettyDate(viewDate), dateNav())}
    <div class="card">
      <h2>App Saúde do iPhone</h2>
      ${D.health ? `<div class="grid3 num">
          <div><div class="tiny">Energia ativa</div><b>${D.health.active != null ? fmt(D.health.active) : '—'}</b></div>
          <div><div class="tiny">Passos</div><b>${D.health.steps != null ? fmt(D.health.steps) : '—'}</b></div>
          <div><div class="tiny">Atualizado</div><b>${new Date(D.health.ts).toTimeString().slice(0, 5)}</b></div>
        </div>` : `<p class="sub">Ainda sem dados importados para este dia.</p>`}
      <button class="full" id="paste" style="margin-top:12px">📋 Importar do Saúde (colar)</button>
      <details style="margin-top:12px">
        <summary>Colar manualmente</summary>
        <textarea id="htxt" placeholder="FIT;active=520;steps=9400;weight=82,4" style="margin-top:8px"></textarea>
        <button class="btn-2 full" id="hgo" style="margin-top:8px">Importar texto</button>
      </details>
      <details style="margin-top:12px">
        <summary>Como conectar ao app Saúde (1 vez só)</summary>
        <p class="tiny" style="margin:8px 0">O iPhone não deixa apps web lerem o Saúde direto. A ponte é um Atalho que lê os dados e copia para cá:</p>
        <ol class="steps">
          <li>Abra o app <b>Atalhos</b> → <b>+</b> → nomeie como <b>FitCoach Saúde</b>.</li>
          <li>Adicione <b>Encontrar Amostras de Saúde</b>: Tipo = <b>Energia Ativa</b>, Data de Início = <b>Hoje</b>. Depois <b>Calcular Estatísticas</b> → <b>Soma</b>.</li>
          <li>Repita para <b>Passos</b> (Soma). Opcional: <b>Peso</b>, ordenado pelo mais recente, limite 1.</li>
          <li>Adicione <b>Texto</b> com: <code>FIT;active=[Soma energia];steps=[Soma passos];weight=[Peso]</code> (toque nas variáveis para inseri-las).</li>
          <li>Adicione <b>Copiar para Área de Transferência</b> e, por fim, <b>Mostrar Notificação</b> “Dados copiados — abra o FitCoach”.</li>
          <li>Rode o atalho, abra o FitCoach e toque em <b>Importar do Saúde</b>. Dica: em Atalhos → Automação, agende para rodar todo dia às 21h.</li>
        </ol>
      </details>
    </div>

    <div class="card">
      <h2>Adicionar treino</h2>
      <p class="tiny" style="margin-bottom:6px">Use para treinos que <b>não</b> aparecem no app Saúde (sem Apple Watch), senão conta em dobro.</p>
      <label for="at">Atividade</label>
      <select id="at">${METS.map(([n, m]) => `<option value="${m}">${n}</option>`).join('')}</select>
      <div class="grid2">
        <div><label for="am">Minutos</label><input id="am" inputmode="numeric" value="45"></div>
        <div><label for="ak">kcal (calculado)</label><input id="ak" inputmode="numeric"></div>
      </div>
      <button class="full" id="aadd" style="margin-top:12px">Adicionar</button>
    </div>

    <div class="card">
      <h2>Treinos do dia</h2>
      ${D.acts.length ? `<ul class="list">${D.acts.map((a) => `<li><div class="thumb">🏋️</div>
        <div class="grow"><div class="name">${esc(a.name)}</div><div class="tiny">${a.minutes} min</div></div>
        <b class="num">${fmt(a.kcal)}</b><button class="x" data-del-act="${a.id}" aria-label="Apagar">×</button></li>`).join('')}</ul>`
        : `<p class="sub">Nenhum treino manual.</p>`}
      <p class="tiny" style="margin-top:10px">Você “ganha de volta” ${r0(S.profile.eatback * 100)}% das calorias de exercício acima do seu nível de rotina (${fmt(T.P.baseline)} kcal). Bônus de hoje: <b>${T.bonus >= 0 ? '+' : '−'}${fmt(Math.abs(T.bonus))} kcal</b>.</p>
    </div>`;
  bindCommon();
  const calc = () => { $('#ak').value = r0(num($('#at').value) * currentWeight() * (num($('#am').value) / 60)); };
  calc(); $('#at').onchange = calc; $('#am').oninput = calc;
  $('#aadd').onclick = () => {
    const sel = $('#at'); const minutes = r0(num($('#am').value)); const kcal = r0(num($('#ak').value));
    if (!minutes || !kcal) return toast('Informe a duração.');
    day().acts.push({ id: uid(), name: sel.options[sel.selectedIndex].text, minutes, kcal }); save(); toast('Treino adicionado 💪'); render();
  };
  $$('[data-del-act]').forEach((b) => b.onclick = () => { const D2 = day(); D2.acts = D2.acts.filter((a) => a.id !== b.dataset.delAct); save(); render(); });
  const doImport = (txt) => {
    const h = parseHealth(txt);
    if (applyHealth(h, viewDate)) { toast(`Importado: ${h.active != null ? fmt(h.active) + ' kcal ativas' : ''}${h.steps != null ? ' · ' + fmt(h.steps) + ' passos' : ''}`); render(); }
    else toast('Não encontrei dados. O texto deve ter active=… e/ou steps=…', 4000);
  };
  $('#paste').onclick = async () => {
    try { doImport(await navigator.clipboard.readText()); }
    catch { toast('Não consegui ler a área de transferência. Use “Colar manualmente”.', 4000); }
  };
  $('#hgo').onclick = () => doImport($('#htxt').value);
}

/* ----- DOCE ----- */
const HEALTHY_SWEETS = [
  ['Chocolate 70% cacau (2 quadradinhos, 20 g)', 110, 'Coma devagar, com um café.'],
  ['Iogurte natural + mel + canela (170 g)', 140, '1 colher de chá de mel e canela a gosto.'],
  ['Banana assada com canela', 110, 'Banana em rodelas na airfryer 8 min, canela por cima.'],
  ['Morangos com 1 colher de chocolate derretido', 120, '10 morangos + 10 g de chocolate meio amargo.'],
  ['Picolé de fruta (sem leite)', 70, 'Prefira os de polpa, sem cobertura.'],
  ['“Sorvete” de banana congelada', 120, 'Bata 1 banana congelada com 1 colher de cacau.'],
  ['Mousse de whey + cacau', 150, '1 scoop whey + 1 colher de cacau + 100 ml de leite, bata e gele.'],
  ['Maçã com pasta de amendoim (1 colher de chá)', 130, 'Maçã fatiada + 7 g de pasta de amendoim.'],
];
let cravingResult = null;
let cravingPhoto = null;
function renderDoce() {
  const T = dayTotals(today());
  const rem = T.remaining;
  app.innerHTML = `
    ${header('Vontade de doce?', `Hoje: restam <b class="num">${fmt(Math.max(0, rem))}</b> kcal${rem < 0 ? ` (você está ${fmt(-rem)} acima)` : ''}`)}
    <div class="card">
      <label for="cw">O que você quer comer?</label>
      <input id="cw" placeholder="ex.: brigadeiro, 1 fatia de bolo de cenoura, sorvete…">
      <label class="photo-drop" for="cph" style="margin-top:10px;padding:14px">
        <span>${cravingPhoto ? `<img src="${cravingPhoto.thumb}" style="width:64px;height:64px;border-radius:10px;object-fit:cover" alt="">` : '📷 Foto do doce (opcional)'}</span>
      </label>
      <input id="cph" type="file" accept="image/*" class="hidden">
      <button class="full" id="cgo" style="margin-top:12px">Posso comer?</button>
    </div>
    <div id="cres">${cravingResult ? cravingHTML(cravingResult) : ''}</div>
    <div class="card">
      <h2>Opções mais leves que cabem agora</h2>
      <ul class="list">${HEALTHY_SWEETS.filter(([, k]) => k <= Math.max(rem, 0) + 20).map(([n, k, h]) => `
        <li><div class="grow"><div class="name" style="white-space:normal">${n}</div><div class="tiny">${h}</div></div>
        <b class="num">${k}</b><button class="btn-2" style="min-height:34px;padding:6px 10px" data-quick="${esc(n)}|${k}">+</button></li>`).join('')
        || '<li class="sub">Seu saldo de hoje está zerado. Que tal um chá ou café sem açúcar? Amanhã tem mais 😉</li>'}</ul>
    </div>`;
  $('#cph').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; cravingPhoto = (await prepPhotos([f]))[0]; renderDoce(); };
  $('#cgo').onclick = async (ev) => {
    const want = $('#cw').value.trim();
    if (!want && !cravingPhoto) return toast('Conte o que você quer comer.');
    const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Calculando…';
    const ctx = {
      horario: new Date().toTimeString().slice(0, 5),
      objetivo: `${S.profile.goal < currentWeight() ? 'perder' : 'manter/ganhar'} peso: ${currentWeight()} kg → ${S.profile.goal} kg`,
      meta_kcal_hoje: r0(T.target), consumido_kcal: r0(T.eaten.kcal), saldo_restante_kcal: r0(rem),
      proteina_g: `${r0(T.eaten.p)} de ${T.macroTarget.p}`,
      refeicoes_registradas: T.D.meals.map((m) => `${m.time} ${m.type}: ${m.name} (${m.kcal} kcal)`),
    };
    const content = [];
    if (cravingPhoto) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(cravingPhoto.full) } });
    content.push({ type: 'text', text: `Contexto do dia:\n${JSON.stringify(ctx, null, 2)}\n\nVontade: ${want || '(ver foto)'}` });
    try {
      cravingResult = await claudeJSON({ system: CRAVING_SYSTEM, content, schema: CRAVING_SCHEMA, effort: 'low' });
      cravingResult._thumb = cravingPhoto?.thumb || null;
      cravingPhoto = null;
      renderDoce();
    } catch (e) {
      toast(e.message || String(e), 4500); btn.disabled = false; btn.textContent = 'Posso comer?';
    }
  };
  bindCravingButtons();
}
function cravingHTML(r) {
  const v = { pode: ['ok', '✅ Pode, sem culpa'], porcao_menor: ['warn', '⚖️ Pode, numa porção menor'], melhor_nao: ['bad', '🛑 Hoje melhor não'] }[r.verdict];
  return `<div class="verdict ${v[0]}">
    <h3>${v[1]}</h3>
    <div class="muted">${esc(r.desired_item)} ≈ <b class="num">${fmt(r.desired_kcal)} kcal</b>${r.recommended_portion ? ` · porção sugerida: <b>${esc(r.recommended_portion)}</b>` : ''}</div>
    <p style="margin-top:8px">${esc(r.message)}</p>
    ${r.verdict !== 'melhor_nao' ? `<button class="btn-2" style="margin-top:10px" data-quick="${esc(r.desired_item + (r.recommended_portion ? ' (' + r.recommended_portion + ')' : ''))}|${r0(r.desired_kcal)}|t">Registrar que comi</button>` : ''}
  </div>
  ${r.alternatives?.length ? `<div class="card"><h2>Alternativas mais saudáveis</h2><ul class="list">${r.alternatives.map((a) => `
    <li><div class="grow"><div class="name" style="white-space:normal">${esc(a.name)}</div><div class="tiny">${esc(a.how_to)}</div></div>
    <b class="num">${fmt(a.kcal)}</b><button class="btn-2" style="min-height:34px;padding:6px 10px" data-quick="${esc(a.name)}|${r0(a.kcal)}">+</button></li>`).join('')}</ul></div>` : ''}`;
}
function bindCravingButtons() {
  $$('[data-quick]').forEach((b) => b.onclick = () => {
    const [name, kcal, withThumb] = b.dataset.quick.split('|');
    const k = num(kcal);
    // estimativa de macros de doce: 55% carbo, 35% gordura, 10% proteína
    day(today()).meals.push({ id: uid(), type: 'Doce', name, time: new Date().toTimeString().slice(0, 5), kcal: r0(k),
      p: r1(k * 0.1 / 4), c: r1(k * 0.55 / 4), f: r1(k * 0.35 / 9), thumb: withThumb ? cravingResult?._thumb || null : null, items: [] });
    save(); cravingResult = null; toast('Registrado 🍫'); viewDate = today(); go('hoje');
  });
}

/* ----- PROGRESSO ----- */
let coachResult = null;
function weightChart() {
  const ws = [...S.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  if (ws.length < 2) return `<p class="sub">Registre seu peso algumas vezes por semana para ver o gráfico.</p>`;
  const W = 340, H = 160, pad = 26;
  const xs = ws.map((w) => new Date(w.date).getTime());
  const ys = ws.map((w) => w.kg).concat([S.profile.goal]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.floor(Math.min(...ys) - 0.5), y1 = Math.ceil(Math.max(...ys) + 0.5);
  const X = (t) => pad + ((t - x0) / Math.max(1, x1 - x0)) * (W - pad - 8);
  const Y = (v) => 8 + (1 - (v - y0) / Math.max(0.1, y1 - y0)) * (H - pad - 8);
  const path = ws.map((w, i) => `${i ? 'L' : 'M'}${X(new Date(w.date).getTime()).toFixed(1)},${Y(w.kg).toFixed(1)}`).join('');
  const gy = Y(S.profile.goal);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de peso">
    <line x1="${pad}" x2="${W - 8}" y1="${gy}" y2="${gy}" stroke="var(--accent)" stroke-dasharray="4 4"/>
    <text x="${W - 10}" y="${gy - 4}" text-anchor="end">meta ${S.profile.goal} kg</text>
    <text x="2" y="${Y(y1) + 4}">${y1}</text><text x="2" y="${Y(y0)}">${y0}</text>
    <path d="${path}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${ws.map((w) => `<circle cx="${X(new Date(w.date).getTime())}" cy="${Y(w.kg)}" r="3" fill="var(--blue)"/>`).join('')}
    <text x="${pad}" y="${H - 6}">${new Date(ws[0].date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</text>
    <text x="${W - 8}" y="${H - 6}" text-anchor="end">${new Date(ws[ws.length - 1].date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</text>
  </svg>`;
}
function weekChart() {
  const W = 340, H = 140, days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(today(), -i); const t = dayTotals(d); days.push({ d, kcal: t.eaten.kcal, target: t.target }); }
  const max = Math.max(...days.map((x) => Math.max(x.kcal, x.target))) * 1.1 || 1;
  const bw = (W - 20) / 7;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calorias da semana">
    ${days.map((x, i) => {
      const h = (x.kcal / max) * (H - 30), ty = H - 20 - (x.target / max) * (H - 30), bx = 10 + i * bw;
      const c = x.kcal === 0 ? 'var(--line)' : x.kcal > x.target ? 'var(--bad)' : 'var(--accent)';
      return `<rect x="${bx + 6}" y="${H - 20 - h}" width="${bw - 12}" height="${Math.max(h, 2)}" rx="4" fill="${c}"/>
        <line x1="${bx + 2}" x2="${bx + bw - 2}" y1="${ty}" y2="${ty}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
        <text x="${bx + bw / 2}" y="${H - 5}" text-anchor="middle">${new Date(x.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'narrow' })}</text>`;
    }).join('')}
  </svg>`;
}
function renderProgresso() {
  const p = S.profile, w = currentWeight(), P = plan();
  const t = weightTrend(21);
  const sug = adaptiveSuggestion();
  const toGo = r1(w - p.goal);
  let eta = '';
  const rate = t && Math.abs(t.perWeek) > 0.05 && Math.sign(t.perWeek) === Math.sign(-toGo) ? Math.abs(t.perWeek) : p.pace;
  if (Math.abs(toGo) > 0.2 && rate > 0) { const weeks = Math.abs(toGo) / rate; const d = new Date(); d.setDate(d.getDate() + weeks * 7); eta = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); }
  app.innerHTML = `
    ${header('Progresso', `${w} kg → meta ${p.goal} kg`)}
    <div class="card">
      <div class="grid3 num">
        <div><div class="tiny">Atual</div><b class="big" style="font-size:24px">${w}</b><span class="tiny"> kg</span></div>
        <div><div class="tiny">Falta</div><b class="big" style="font-size:24px">${Math.abs(toGo)}</b><span class="tiny"> kg</span></div>
        <div><div class="tiny">Tendência</div><b class="big" style="font-size:24px">${t ? (t.perWeek > 0 ? '+' : '') + r1(t.perWeek) : '—'}</b><span class="tiny"> kg/sem</span></div>
      </div>
      ${eta ? `<p class="tiny" style="margin-top:8px">No ritmo ${t ? 'atual' : 'planejado'}, você chega na meta por volta de <b>${eta}</b>.</p>` : ''}
      <div style="margin-top:12px">${weightChart()}</div>
      <div class="row" style="margin-top:12px">
        <input id="wkg" inputmode="decimal" placeholder="Peso de hoje (kg)" style="flex:1">
        <button id="wadd">Salvar</button>
      </div>
      <p class="tiny" style="margin-top:6px">Pese-se de manhã, em jejum, após ir ao banheiro. O app usa a tendência, não o número de um dia.</p>
    </div>

    <div class="card">
      <h2>Últimos 7 dias</h2>
      ${weekChart()}
      <p class="tiny">Barras = consumido · tracejado = meta do dia</p>
    </div>

    <div class="card">
      <h2>Ajuste automático da meta</h2>
      ${sug ? `<p class="muted" style="font-size:14px">Tendência real: <b>${sug.trend > 0 ? '+' : ''}${r1(sug.trend)} kg/sem</b> · planejado: <b>${sug.planned > 0 ? '+' : ''}${r1(sug.planned)} kg/sem</b> · registros: <b>${r0(sug.adherence * 100)}%</b> dos dias.</p>
        ${sug.adherence < 0.6 ? `<p class="tiny" style="margin-top:6px">Registre as refeições em mais dias para eu poder ajustar com segurança.</p>`
        : Math.abs(sug.change) < 50 ? `<p style="margin-top:6px">✅ Você está no ritmo. Mantenha a meta atual.</p>`
        : `<p style="margin-top:6px">Sugestão: <b>${sug.change > 0 ? '+' : ''}${sug.change} kcal/dia</b> na meta base.</p>
           <button class="full" style="margin-top:10px" data-apply="${sug.change}">Aplicar ajuste</button>`}`
        : `<p class="sub">Preciso de pelo menos 3 pesagens em 7+ dias para calcular sua tendência.</p>`}
      <p class="tiny" style="margin-top:10px">Meta base atual: <b class="num">${fmt(P.base)} kcal</b> (gasto estimado ${fmt(P.baseTdee)} ${P.losing ? '−' : P.gaining ? '+' : '±'} ${fmt(P.losing || P.gaining ? P.delta : 0)}${S.adjust ? ` ${S.adjust > 0 ? '+' : '−'} ${Math.abs(S.adjust)} de ajuste` : ''}).
      ${S.adjust ? `<button class="btn-ghost" id="resetadj">Zerar ajustes</button>` : ''}</p>
    </div>

    <div class="card">
      <h2>Revisão do coach (IA)</h2>
      <p class="sub">Analisa suas 2 últimas semanas: alimentação, treinos e peso.</p>
      <button class="full" id="coach" style="margin-top:10px">🧠 Pedir revisão</button>
      <div id="coachres">${coachResult ? coachHTML(coachResult) : ''}</div>
    </div>`;
  bindCommon();
  $('#wadd').onclick = () => { const kg = num($('#wkg').value); if (kg < 25 || kg > 400) return toast('Peso inválido.'); addWeight(today(), kg); save(); toast('Peso salvo'); render(); };
  $$('[data-apply]').forEach((b) => b.onclick = () => { S.adjust = (S.adjust || 0) + num(b.dataset.apply); S.coachLog.push({ date: today(), headline: 'Ajuste automático', adjust: num(b.dataset.apply) }); save(); toast('Meta ajustada'); render(); });
  const ra = $('#resetadj'); if (ra) ra.onclick = () => { S.adjust = 0; save(); render(); };
  $('#coach').onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analisando…';
    const hist = [];
    for (let i = 14; i >= 0; i--) {
      const d = addDays(today(), -i); const x = S.days[d]; if (!x) continue; const tt = dayTotals(d);
      hist.push({ dia: d, meta: r0(tt.target), consumido: r0(tt.eaten.kcal), proteina_g: r0(tt.eaten.p), refeicoes: x.meals.length,
        gasto_ativo: r0(tt.activity), passos: x.health?.steps ?? null, treinos: x.acts.map((a) => `${a.name} ${a.minutes}min`) });
    }
    const ctx = {
      perfil: { sexo: p.sex, idade: p.age, altura_cm: p.height, peso_atual: w, meta_peso: p.goal, ritmo_kg_semana: p.pace },
      meta_base_kcal: r0(P.base), ajuste_atual: S.adjust, piso_kcal: P.floor, proteina_meta_g: P.protein,
      tendencia_peso_kg_sem: t ? r1(t.perWeek) : null, pesagens: S.weights.slice(-20), dias: hist,
    };
    try {
      coachResult = await claudeJSON({ system: COACH_SYSTEM, content: [{ type: 'text', text: JSON.stringify(ctx) }], schema: COACH_SCHEMA, effort: 'high' });
      render();
    } catch (e) { toast(e.message || String(e), 4500); btn.disabled = false; btn.textContent = '🧠 Pedir revisão'; }
  };
  $$('[data-coach-apply]').forEach((b) => b.onclick = () => {
    const a = num(b.dataset.coachApply); S.adjust = (S.adjust || 0) + a; S.coachLog.push({ date: today(), headline: coachResult.headline, adjust: a });
    coachResult = null; save(); toast('Meta ajustada pelo coach'); render();
  });
}
function coachHTML(r) {
  return `<div style="margin-top:14px">
    <h3>${esc(r.headline)}</h3>
    <p class="muted" style="margin-top:6px;font-size:15px">${esc(r.analysis)}</p>
    <ul style="margin:10px 0 0 18px;font-size:15px">${r.tips.map((t) => `<li style="margin:4px 0">${esc(t)}</li>`).join('')}</ul>
    <div class="callout"><b>Treino da semana:</b> ${esc(r.workout_plan)}</div>
    ${r.suggested_adjust_kcal ? `<button class="full" style="margin-top:10px" data-coach-apply="${r.suggested_adjust_kcal}">Aplicar ${r.suggested_adjust_kcal > 0 ? '+' : ''}${r.suggested_adjust_kcal} kcal na meta</button>` : `<p class="tiny" style="margin-top:8px">Sem mudança na meta por enquanto.</p>`}
  </div>`;
}

/* ----- AJUSTES / ONBOARDING ----- */
function renderAjustes() {
  const p = S.profile || { name: '', sex: 'm', age: 35, height: 175, startWeight: 85, goal: 78, pace: 0.5, factor: 1.2, eatback: 0.75 };
  const first = !S.profile;
  app.innerHTML = `
    ${header(first ? 'Bem-vindo 👋' : 'Ajustes', first ? 'Vamos calcular sua meta. Leva 1 minuto.' : '', first ? '' : `<button class="btn-2" style="min-height:36px" data-go="hoje">Fechar</button>`)}
    <div class="card">
      <h2>Seu perfil</h2>
      <label for="pn">Nome</label><input id="pn" value="${esc(p.name)}" autocomplete="given-name">
      <div class="grid2">
        <div><label for="ps">Sexo</label><select id="ps"><option value="m" ${p.sex === 'm' ? 'selected' : ''}>Masculino</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Feminino</option></select></div>
        <div><label for="pa">Idade</label><input id="pa" inputmode="numeric" value="${p.age}"></div>
        <div><label for="ph2">Altura (cm)</label><input id="ph2" inputmode="numeric" value="${p.height}"></div>
        <div><label for="pw">Peso atual (kg)</label><input id="pw" inputmode="decimal" value="${first ? p.startWeight : currentWeight()}"></div>
        <div><label for="pg">Meta (kg)</label><input id="pg" inputmode="decimal" value="${p.goal}"></div>
        <div><label for="pp">Ritmo (kg/semana)</label><select id="pp">
          ${[[0.25, '0,25 · leve'], [0.5, '0,5 · recomendado'], [0.75, '0,75 · acelerado'], [1, '1,0 · agressivo']].map(([v, l]) => `<option value="${v}" ${p.pace == v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      </div>
      <label for="pf">Rotina fora dos treinos</label>
      <select id="pf">
        ${[[1.2, 'Sentado a maior parte do dia'], [1.3, 'Em pé / anda um pouco no trabalho'], [1.45, 'Trabalho físico / anda muito']].map(([v, l]) => `<option value="${v}" ${p.factor == v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label for="pe">Calorias de exercício que você “ganha de volta”</label>
      <select id="pe">${[[0.5, '50% (mais conservador)'], [0.75, '75% (recomendado)'], [1, '100%']].map(([v, l]) => `<option value="${v}" ${p.eatback == v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div id="preview" class="callout"></div>
    </div>

    <div class="card">
      <h2>Inteligência artificial</h2>
      <p class="tiny">As fotos são analisadas pelo Claude, da Anthropic. Crie uma chave em <b>console.anthropic.com</b> → API Keys e cole aqui. Ela fica salva só neste iPhone.</p>
      <label for="ak2">Chave da API</label>
      <input id="ak2" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(S.settings.apiKey)}">
      <label for="am2">Modelo</label>
      <select id="am2">
        ${[['claude-opus-5-5', 'Claude Opus 5.5 · mais preciso'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 · equilibrado'], ['claude-haiku-5-5', 'Claude Haiku 5.5 · mais barato']]
          .map(([v, l]) => `<option value="${v}" ${S.settings.model === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label for="th">Aparência</label>
      <select id="th">${[['auto', 'Automática'], ['light', 'Clara'], ['dark', 'Escura']].map(([v, l]) => `<option value="${v}" ${S.settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>

    <button class="full" id="psave" style="margin-top:14px">${first ? 'Começar' : 'Salvar'}</button>

    ${first ? '' : `<div class="card">
      <h2>Seus dados</h2>
      <p class="tiny">Tudo fica guardado só neste aparelho. Faça backup de vez em quando.</p>
      <div class="grid2" style="margin-top:10px">
        <button class="btn-2" id="exp">⬇️ Exportar backup</button>
        <label class="btn btn-2" for="imp" style="cursor:pointer">⬆️ Importar</label>
      </div>
      <input id="imp" type="file" accept="application/json,.json" class="hidden">
      <button class="btn-bad full" id="wipe" style="margin-top:10px">Apagar tudo</button>
    </div>`}

    <div class="card">
      <h2>Instalar no iPhone</h2>
      <ol class="steps"><li>Abra este endereço no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (quadrado com seta).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li></ol>
      <p class="tiny" style="margin-top:8px">Este app não substitui acompanhamento de nutricionista ou médico. Estimativas por foto têm margem de erro de ~10–20%.</p>
    </div>`;
  bindCommon();
  const read = () => ({
    name: $('#pn').value.trim(), sex: $('#ps').value, age: r0(num($('#pa').value)), height: r0(num($('#ph2').value)),
    startWeight: r1(num($('#pw').value)), goal: r1(num($('#pg').value)), pace: num($('#pp').value), factor: num($('#pf').value), eatback: num($('#pe').value),
  });
  const preview = () => {
    const q = read(); if (!q.age || !q.height || !q.startWeight) return;
    const B = bmr(q, q.startWeight), tdee = B * q.factor, losing = q.goal < q.startWeight, gaining = q.goal > q.startWeight;
    const d = Math.min(1000, (q.pace * 7700) / 7), floor = q.sex === 'f' ? 1200 : 1500;
    const base = Math.max(floor, tdee + (losing ? -d : gaining ? d : 0) + (S.adjust || 0));
    const weeks = Math.abs(q.startWeight - q.goal) / q.pace;
    $('#preview').innerHTML = `Metabolismo basal <b>${fmt(B)}</b> · gasto sem treino <b>${fmt(tdee)}</b><br>
      Sua meta: <b>${fmt(base)} kcal/dia</b> + bônus de exercício. ${weeks > 0.5 ? `Previsão: ~${Math.ceil(weeks)} semanas.` : ''}
      ${base === floor ? '<br><span class="tiny">Meta no piso de segurança — considere um ritmo menor.</span>' : ''}`;
  };
  $$('input,select', app).forEach((el) => el.addEventListener('input', preview)); preview();
  $('#psave').onclick = () => {
    const q = read();
    if (!q.age || !q.height || !q.startWeight || !q.goal) return toast('Preencha idade, altura, peso e meta.');
    const wasFirst = !S.profile;
    S.profile = { ...(S.profile || { startDate: today() }), ...q };
    if (wasFirst || !S.weights.length) addWeight(today(), q.startWeight);
    else if (q.startWeight !== currentWeight()) addWeight(today(), q.startWeight);
    S.settings.apiKey = $('#ak2').value.trim(); S.settings.model = $('#am2').value; S.settings.theme = $('#th').value;
    save(); toast('Salvo ✅'); go('hoje');
  };
  if (!first) {
    $('#exp').onclick = () => {
      const data = { ...S, settings: { ...S.settings, apiKey: '' } };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fitcoach-backup-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#imp').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text()); if (!data.profile) throw 0;
        const key = S.settings.apiKey; S = Object.assign(defaultState(), data); if (!S.settings.apiKey) S.settings.apiKey = key;
        save(); toast('Backup restaurado'); go('hoje');
      } catch { toast('Arquivo de backup inválido.'); }
    };
    $('#wipe').onclick = () => { if (confirm('Apagar todos os dados deste app? Não dá para desfazer.')) { localStorage.removeItem(STORE_KEY); S = defaultState(); go('ajustes'); } };
  }
}

/* ---------------- inicialização ---------------- */
// Importação via URL: ...?health=1&active=520&steps=9400&weight=82.4&date=2026-11-04
(() => {
  const q = new URLSearchParams(location.search);
  if (S.profile && (q.has('active') || q.has('steps') || q.has('weight'))) {
    const h = parseHealth([...q.entries()].map(([k, v]) => `${k}=${v}`).join(';'));
    if (applyHealth(h)) { tab = 'atividade'; setTimeout(() => toast('Dados do Saúde importados ✅'), 300); }
    history.replaceState(null, '', location.pathname);
  }
})();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
