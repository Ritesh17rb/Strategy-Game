// Pure front-end Case Study Simulator
// Sign-in required for saved sessions; streaming via asyncllm; config via bootstrap-llm-provider; alerts via bootstrap-alert

// Tiny DOM helpers
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s))

// Dynamic loader with CDN fallback
async function loadModule(name, url) { try { return await import(name) } catch { return await import(url) } }

// Supabase client (replace with your own project creds)
const supabaseUrl = "https://nnqutlsuisayoqvfyefh.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucXV0bHN1aXNheW9xdmZ5ZWZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwOTM0MzksImV4cCI6MjA3OTY2OTQzOX0.y5M_9F2wKDZ9D0BSlmrObE-JRwkrWVUMMYwKZuz1-fo"
let supabase
;(async () => {
  const { createClient } = await loadModule('@supabase/supabase-js', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
  supabase = createClient(supabaseUrl, supabaseKey, { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
})()
const waitSupabaseReady = () => new Promise((r) => { const t = setInterval(() => { if (supabase) { clearInterval(t); r() } }, 50) })

// LLM config defaults
const STORAGE_KEY = "bootstrapLLMProvider_openaiConfig"
const DEFAULT_BASE_URL = "https://llmfoundry.straive.com/openai/v1"
const DEFAULT_MODEL = "gpt-5-nano"
const setLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const getLocal = (k, def = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def } catch { return def } }
async function loadOrInitOpenAIConfig() { const init = { baseUrl: DEFAULT_BASE_URL, apiKey: "", models: [DEFAULT_MODEL] }; const cfg = getLocal(STORAGE_KEY); if (cfg?.baseUrl) return cfg; setLocal(STORAGE_KEY, init); return init }

// Alerts via bootstrap-alert; fallback injects a Bootstrap alert div
async function showAlert({ title = "", body = "", color = "info", replace = false }) {
  try { const { bootstrapAlert } = await loadModule('bootstrap-alert', 'https://cdn.jsdelivr.net/npm/bootstrap-alert@1/+esm'); bootstrapAlert({ title, body, color, replace }) }
  catch {
    const holderId = 'alert-holder'; let holder = document.getElementById(holderId)
    if (!holder) { holder = document.createElement('div'); holder.id = holderId; holder.style.position = 'fixed'; holder.style.top = '1rem'; holder.style.right = '1rem'; holder.style.zIndex = '1080'; document.body.appendChild(holder) }
    if (replace) holder.innerHTML = ''
    const div = document.createElement('div'); div.className = `alert alert-${color} shadow`; div.role = 'alert'; div.style.minWidth = '260px'
    div.innerHTML = `${title ? `<div class="fw-semibold mb-1">${title}</div>` : ''}${body || ''}`
    holder.appendChild(div); setTimeout(() => div.remove(), 4000)
  }
}

// Dark theme toggle
$$('[data-bs-theme-value]').forEach(btn => btn.addEventListener('click', () => { const v = btn.getAttribute('data-bs-theme-value'); const theme = v === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v; document.documentElement.setAttribute('data-bs-theme', theme) }))

// State
let session = null
let gameSessionId = null
let messages = []
let freshChatActive = false
let selectedSession = null
let selectedMessages = []

// Markdown renderer with fallback; also emphasizes strong text
async function renderMarkdown(text) {
  const src = String(text || '')
  try {
    const mod = await loadModule('marked', 'https://cdn.jsdelivr.net/npm/marked@12/+esm')
    mod.marked.setOptions({ breaks: true })
    return mod.marked.parse(src)
  } catch {
    return src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')
  }
}

// Start a new case (requires sign-in)
async function startNewGame(demo) {
  freshChatActive = false
  if (!session?.user?.id) { await showAlert({ title: 'Please sign in', color: 'warning' }); return }
  await waitSupabaseReady();
  let data, error
  ;({ data, error } = await supabase.from('game_sessions').insert([{ user_id: session.user.id, demo_id: demo?.id }]).select())
  if (error) {
    ;({ data, error } = await supabase.from('game_sessions').insert([{ user_id: session.user.id }]).select())
    if (error) { await showAlert({ title: 'Failed to start', body: String(error?.message || error), color: 'danger' }); return }
  }
  gameSessionId = data?.[0]?.id; messages = []; $('#chat').innerHTML = ''
  appendMsg('ai', 'Starting: ' + (demo?.title || 'Case'))
  const firstUser = demo?.prompt || 'Start the scenario.'
  const intro = await fetchAIResponse([{ role: 'user', content: firstUser }])
  messages.push({ role: 'ai', content: intro }); appendMsg('ai', intro)
  $('#user-input').disabled = false; $('#send-btn').disabled = false
}

// Start a fresh chat (no scenario, no sign-in required, not saved)
function startFreshChat() {
  gameSessionId = null
  freshChatActive = true
  messages = []
  $('#chat').innerHTML = ''
  $('#user-input').disabled = false
  $('#send-btn').disabled = false
}

// Configure LLM + open Advanced Settings (requires sign-in)
$('#configure-llm')?.addEventListener('click', async () => {
  if (!session?.user?.id) { await signIn(); if (!session?.user?.id) return }
  try { const { openaiConfig } = await loadModule('bootstrap-llm-provider', 'https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1/+esm'); await openaiConfig({ show: true }) }
  catch { await showAlert({ title: 'Configure LLM failed', body: 'Provider UI did not load. Check network.', color: 'danger' }) }
  const adv = $('#advanced-settings'); if (adv) { try { const c = bootstrap.Collapse.getOrCreateInstance(adv, { toggle: false }); c.show() } catch { adv.classList.add('show') }; $('#model')?.focus() }
})

// Load app config and demos
async function loadConfig() {
  try { const res = await fetch('config.json'); if (!res.ok) throw new Error('config.json not found'); return await res.json() } catch { return { title: 'Case Study Simulator', subtitle: 'High-stakes management practice with one click', demos: [], systemPrompt: 'You are "The Executive"...', model: DEFAULT_MODEL, temperature: 0.7 } }
}

// Demo cards UI
async function renderDemoCards(cfg) {
  const row = $('#demo-cards .row'); row.innerHTML = ''
  cfg.demos.forEach(d => { const col = document.createElement('div'); col.className = 'col-md-4 col-lg-3'; col.innerHTML = `
    <div class="card demo-card h-100" data-demo-id="${d.id}">
      <div class="card-body d-flex flex-column">
        <div class="mb-3"><i class="fs-1 text-primary bi ${d.icon}"></i></div>
        <h6 class="card-title h5 mb-2">${d.title}</h6>
        <p class="card-text">${d.desc}</p>
        <div class="mt-auto"><button class="btn btn-primary w-100 start-demo" disabled>Start</button></div>
      </div>
    </div>`; row.appendChild(col) })
  // Add a "Start Fresh" card that does not require sign-in
  const freshCol = document.createElement('div'); freshCol.className = 'col-md-4 col-lg-3'; freshCol.innerHTML = `
    <div class="card demo-card h-100" data-demo-id="__fresh__">
      <div class="card-body d-flex flex-column">
        <div class="mb-3"><i class="fs-1 text-success bi bi-lightning-charge-fill"></i></div>
        <h6 class="card-title h5 mb-2">Start Fresh</h6>
        <p class="card-text">Begin a free-form chat with the advisor. No preset scenario, no sign-in required.</p>
        <div class="mt-auto"><button class="btn btn-success w-100 start-demo">Start</button></div>
      </div>
    </div>`; row.appendChild(freshCol)

  row.addEventListener('click', (e) => {
    const btn = e.target.closest('.start-demo'); if (!btn) return; const card = e.target.closest('.demo-card'); const id = card?.dataset?.demoId;
    if (id === '__fresh__') { startFreshChat(); return }
    const demo = cfg.demos.find(x => x.id === id); if (demo) startNewGame(demo)
  })
}

// Chat rendering
function appendMsg(role, text) {
  const chat = document.querySelector('#chat')
  const wrap = document.createElement('div')
  wrap.className = 'chat-msg-wrap ' + (role === 'user' ? 'msg-user text-end' : 'msg-ai')
  const header = role === 'ai' ? '<i class="bi bi-cpu-fill"></i> <span class="fw-semibold">Advisor</span>' : '<span class="fw-semibold">You</span> <i class="bi bi-person-circle"></i>'
  wrap.innerHTML = `<div class="small mb-1">${header}</div><div class="bubble p-2 rounded-3 d-inline-block text-start"><div class="markdown-body"></div></div>`
  const md = wrap.querySelector('.markdown-body')
  md.innerHTML = (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')
  if (role === 'ai') { try { renderMarkdown(text).then(html => { md.innerHTML = html }) } catch {} }
  chat.appendChild(wrap)
  chat.scrollTop = chat.scrollHeight
  return md
}
let streamMsgEl = null; function ensureStreamEl() { if (!streamMsgEl) streamMsgEl = appendMsg('ai', ''); return streamMsgEl } function clearStreamEl() { streamMsgEl = null }
function setLoading(v) { $('#user-input').disabled = v; $('#send-btn').disabled = v }

// LLM calls (streaming uses system prompt + temperature)
async function* streamAIResponse(history) {
  try {
    const cfg = await loadConfig();
    const systemPrompt = $('#system-prompt')?.value?.trim() || cfg.systemPrompt;
    const formModel = ($('#model')?.value || '').trim();
    const formTemp = parseFloat($('#temperature')?.value || `${cfg.temperature}`);
    const ocfg = await loadOrInitOpenAIConfig();
    const baseUrl = (ocfg?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiKey = ocfg?.apiKey || '';
    const model = formModel || (ocfg?.models?.[0]) || cfg.model || DEFAULT_MODEL;
    const temperature = isNaN(formTemp) ? (cfg.temperature || 0.7) : formTemp;
    const { asyncLLM } = await loadModule('asyncllm', 'https://cdn.jsdelivr.net/npm/asyncllm@2/+esm');
    const body = { model, temperature, stream: true, messages: [{ role: 'system', content: systemPrompt }, ...history] };
    for await (const { content, error } of asyncLLM(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) })) {
      if (error) throw new Error(error); if (content) yield content
    }
  } catch (e) { console.warn('streamAIResponse failed:', e?.message || e) }
}
async function fetchAIResponse(history) {
  const cfg = await loadConfig();
  const systemPrompt = $('#system-prompt')?.value?.trim() || cfg.systemPrompt;
  const formModel = ($('#model')?.value || '').trim();
  const formTemp = parseFloat($('#temperature')?.value || `${cfg.temperature}`);
  const ocfg = await loadOrInitOpenAIConfig();
  const baseUrl = (ocfg?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const apiKey = ocfg?.apiKey || '';
  const model = formModel || (ocfg?.models?.[0]) || cfg.model || DEFAULT_MODEL;
  const temperature = isNaN(formTemp) ? (cfg.temperature || 0.7) : formTemp;
  let full = '';
  try {
    const { asyncLLM } = await loadModule('asyncllm', 'https://cdn.jsdelivr.net/npm/asyncllm@2/+esm');
    const body = { model, temperature, stream: true, messages: [{ role: 'system', content: systemPrompt }, ...history] };
    let gotStream = false;
    for await (const { content, error } of asyncLLM(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) })) {
      if (error) { console.warn('stream error', error); break }
      if (content) { gotStream = true; full = content }
    }
  } catch (e) {
    console.warn('LLM stream failed; falling back:', e?.message || e)
    try {
      const body = { model, temperature, messages: [{ role: 'system', content: systemPrompt }, ...history] };
    } catch (ee) {
      await showAlert({ title: 'LLM request failed', body: String(ee?.message || ee), color: 'danger' })
    }
  }
  return full || ''
}
// Auth UI state
async function refreshAuthState() {
  if (!supabase) return;
  const { data: { session: s } } = await supabase.auth.getSession();
  session = s;
  const signedIn = !!session;
  $('#auth-btn').classList.toggle('d-none', signedIn);
  $('#profile-btn').classList.toggle('d-none', !signedIn);
  $('#signout-btn').classList.toggle('d-none', !signedIn);
  // Allow "Start Fresh" even when signed out
  $$('.start-demo').forEach(b => {
    const id = b.closest('.demo-card')?.dataset?.demoId
    b.disabled = !signedIn && id !== '__fresh__'
  })
  // Input is enabled only if we have an active session OR fresh chat
  const hasActive = !!gameSessionId || freshChatActive || ($('#chat').children.length > 0)
  $('#user-input').disabled = !hasActive && !signedIn
  $('#send-btn').disabled = !hasActive && !signedIn
}

// Auth actions
async function signIn() { await showAlert({ title: 'Signing in', body: 'Opening Google OAuth...', color: 'info', replace: true }); await waitSupabaseReady(); let ensure; try { const mod = await loadModule('supabase-oauth-popup', 'https://cdn.jsdelivr.net/npm/supabase-oauth-popup@1/dist/index.js'); ensure = mod.default } catch {} if (!ensure) { try { await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } }); return } catch (e) { await showAlert({ title: 'Sign-in unavailable', body: 'OAuth script not loaded and redirect failed. Check network.', color: 'danger' }); return } } try { const s = await ensure(supabase, { provider: 'google' }); session = s; await refreshAuthState(); await showAlert({ title: 'Signed in', color: 'success', body: s?.user?.email || 'Login ok', replace: true }) } catch (err) { await showAlert({ title: 'Login failed', body: String(err), color: 'danger' }) } }
async function signOut() { try { await waitSupabaseReady(); await supabase.auth.signOut(); await showAlert({ title: 'Signed out', body: 'You have been signed out.', color: 'info', replace: true }) } catch (err) { await showAlert({ title: 'Sign-out failed', body: String(err), color: 'danger' }) } finally { await refreshAuthState() } }

// Send chat
async function handleSend() {
  const input = $('#user-input').value.trim(); if (!input) return; $('#user-input').value = '';
  messages = messages.filter(m => m.role !== 'ai-temp').concat([{ role: 'user', content: input }]);
  appendMsg('user', input);
  setLoading(true);
  try {
    if (session?.user?.id && gameSessionId) { await supabase.from('chat_messages').insert([{ session_id: gameSessionId, role: 'user', content: input }]) }
    let full = '';
    const bubble = ensureStreamEl();
    try {
      const stream = streamAIResponse(messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })));
      for await (const partial of stream) {
        full = partial;
        bubble.innerHTML = await renderMarkdown(partial);
        $('#chat').scrollTop = $('#chat').scrollHeight;
      }
    } catch {}
    if (!full) {
      full = await fetchAIResponse(messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })));
      bubble.innerHTML = await renderMarkdown(full);
    }
    clearStreamEl();
    messages = messages.filter(m => m.role !== 'ai-temp').concat([{ role: 'ai', content: full }]);
    if (session?.user?.id && gameSessionId) { await supabase.from('chat_messages').insert([{ session_id: gameSessionId, role: 'ai', content: full }]) }
  } catch (e) { await showAlert({ title: 'Error', body: String(e), color: 'danger' }) } finally { setLoading(false) }
}

// Profile modal
function openProfile() { const modalEl = $('#profile-modal'); const modal = bootstrap.Modal.getOrCreateInstance(modalEl); $('#session-list').innerHTML = ''; $('#session-messages').innerHTML = ''; $('#continue-session').disabled = true; $('#delete-session').disabled = true; modal.show(); if (!session?.user?.id) return; (async () => { const { data } = await supabase.from('game_sessions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }); const list = $('#session-list'); (data || []).forEach(s => { const btn = document.createElement('button'); btn.className = 'list-group-item list-group-item-action'; btn.textContent = `Session ${String(s.id).slice(0,8)}`; btn.addEventListener('click', () => viewSession(s)); list.appendChild(btn) }) })() }
async function viewSession(sess) { selectedSession = sess; $('#continue-session').disabled = false; $('#delete-session').disabled = false; const { data } = await supabase.from('chat_messages').select('role, content, created_at').eq('session_id', sess.id).order('created_at', { ascending: true }); selectedMessages = data || []; const pane = $('#session-messages'); pane.innerHTML = ''; selectedMessages.forEach(m => { const div = document.createElement('div'); div.className = 'chat-msg-wrap ' + (m.role === 'user' ? 'msg-user text-end' : 'msg-ai'); const header = m.role === 'ai' ? '<i class="bi bi-cpu-fill"></i> <span class="fw-semibold">Advisor</span>' : '<span class="fw-semibold">You</span> <i class="bi bi-person-circle"></i>'; div.innerHTML = `<div class="small mb-1">${header}</div><div class="bubble p-2 rounded-3 d-inline-block text-start"></div><div class="text-muted" style="font-size:.75rem">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</div>`; div.querySelector('.bubble').textContent = m.content; pane.appendChild(div) }) }
async function continueFromSelected() { if (!selectedSession) return; freshChatActive = false; gameSessionId = selectedSession.id; messages = selectedMessages.map(m => ({ role: m.role, content: m.content })); $('#chat').innerHTML = ''; messages.forEach(m => appendMsg(m.role, m.content)); bootstrap.Modal.getInstance($('#profile-modal')).hide() }
async function deleteSelectedSession() { if (!selectedSession) return; if (!confirm('Delete this session? This will remove its transcript.')) return; await supabase.from('chat_messages').delete().eq('session_id', selectedSession.id); await supabase.from('game_sessions').delete().eq('id', selectedSession.id).eq('user_id', session.user.id); selectedSession = null; selectedMessages = []; $('#session-list').innerHTML = ''; $('#session-messages').innerHTML = ''; $('#continue-session').disabled = true; $('#delete-session').disabled = true }

// Settings persistence (lazy import saveform)
let form; (async () => { try { const mod = await loadModule('saveform', 'https://cdn.jsdelivr.net/npm/saveform@2/+esm'); form = mod.default('#settings-form') } catch {} })(); $('#settings-reset').addEventListener('click', () => form?.clear()); $('#settings-apply').addEventListener('click', () => form?.save())

// Events
$('#send-btn').addEventListener('click', (e) => { e.preventDefault(); handleSend() }); $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); handleSend() }); $('#user-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend() } })
$('#auth-btn').addEventListener('click', signIn); $('#signout-btn').addEventListener('click', signOut); $('#profile-btn').addEventListener('click', openProfile); $('#continue-session').addEventListener('click', continueFromSelected); $('#delete-session').addEventListener('click', deleteSelectedSession)

// Init
;(async () => { const cfg = await loadConfig(); await renderDemoCards(cfg); await waitSupabaseReady(); await refreshAuthState(); if ($('#system-prompt') && !$('#system-prompt').value) $('#system-prompt').value = cfg.systemPrompt; if ($('#model') && !$('#model').value) $('#model').value = cfg.model; if ($('#temperature') && !$('#temperature').value) $('#temperature').value = `${cfg.temperature}`; try { if (cfg.title) { document.title = cfg.title; $('.navbar-brand').textContent = cfg.title; $('.display-1').textContent = cfg.title } if (cfg.subtitle) { $('.display-6').textContent = cfg.subtitle } } catch {} })()











