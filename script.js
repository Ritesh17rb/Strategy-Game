// --- 1. Utilities ---
const $ = (s, parent = document) => parent.querySelector(s);
const $$ = (s, parent = document) => Array.from(parent.querySelectorAll(s));

async function showAlert(t,m){try{const x=await import("https://cdn.jsdelivr.net/npm/bootstrap-alert@1/+esm");const a=(m||"").split("<br>");x.bootstrapAlert({body:a.length>1?a.slice(1).join("<br>"):m,title:a.length>1?a[0]:undefined,color:t,position:"top-0 end-0",replace:true,autohide:true,delay:5000});if(!window.__toastStyle){const st=document.createElement('style');st.textContent='.toast{border-radius:.5rem!important;overflow:hidden;box-shadow:0 .25rem .75rem rgba(0,0,0,.15)}.toast-header{border-radius:.5rem .5rem 0 0!important}.toast-body{border-radius:0 0 .5rem .5rem!important}';document.head.appendChild(st);window.__toastStyle=st;}}catch{const el=document.createElement("div");el.className="alert alert-"+(t||"info")+" alert-dismissible fade show rounded-3 shadow";el.innerHTML=m+"<button type=\"button\" class=\"btn-close\" data-bs-dismiss=\"alert\" aria-label=\"Close\"></button>";(document.querySelector("#alerts")||document.body).appendChild(el);setTimeout(()=>el.remove(),5000);}}// Dynamic Import Loader
const load = async (lib) => import({
  sb: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  llm: 'https://cdn.jsdelivr.net/npm/asyncllm@2/+esm',
  md: 'https://cdn.jsdelivr.net/npm/marked@12/+esm',
  ui: 'https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1/+esm',
  auth: 'https://cdn.jsdelivr.net/npm/supabase-oauth-popup@1/dist/index.js'
}[lib]);

// --- 2. State & Constants ---
const CFG_KEY = "bootstrapLLMProvider_openaiConfig";
const SB_CONFIG = {
  url: "https://nnqutlsuisayoqvfyefh.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucXV0bHN1aXNheW9xdmZ5ZWZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwOTM0MzksImV4cCI6MjA3OTY2OTQzOX0.y5M_9F2wKDZ9D0BSlmrObE-JRwkrWVUMMYwKZuz1-fo"
};

const state = {
  user: null,
  session: null,
  msgs: [],
  config: { demos: [], systemPrompt: "" },
  isFresh: false,
  selectedSession: null,
  signedInToastShown: false
};

let sbClient; // Supabase Client Instance

// --- 3. Core Initialization ---
async function init() {
  // A. Load Config (durable fallback)
  try {
    state.config = await (await fetch('config.json')).json();
  } catch {
    console.warn("Config load failed, using defaults.");
  }
  renderDemos();

  // B. Initialize Supabase
  const { createClient } = await load('sb');
  sbClient = createClient(SB_CONFIG.url, SB_CONFIG.key, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // Handle Auth State
  const { data } = await sbClient.auth.getSession();
  updateAuth(data?.session);
  sbClient.auth.onAuthStateChange((evt, s) => {
    const hadUser = !!state.user; // before update
    updateAuth(s);
    if (evt === 'SIGNED_IN' && !hadUser && !state.signedInToastShown) {
      state.signedInToastShown = true;
      showAlert('success', 'Signed in successfully<br><small>'+(s?.user?.email||'')+'</small>');
    }
    if (evt === 'SIGNED_OUT') { state.signedInToastShown = false; showAlert('danger', 'Signed out successfully.'); }
  });

  // C. Restore UI State
  const savedLLM = getLLMConfig();
  if ($('#system-prompt')) {
    $('#system-prompt').value = state.config.systemPrompt || '';
  }
  if (savedLLM.baseUrl) checkGate();
}

// --- 4. Authentication Logic ---
function updateAuth(session) {
  state.user = session?.user || null;
  const isAuth = !!state.user;

  // Toggle Navbar Buttons
  $('#auth-btn').classList.toggle('d-none', isAuth);
  $('#profile-btn').classList.toggle('d-none', !isAuth);
  $('#signout-btn').classList.toggle('d-none', !isAuth);

  // Enable/Disable Demo Buttons
  $$('.start-demo').forEach(btn => {
    const isFresh = btn.closest('.card').dataset.id === '__fresh__';
    btn.disabled = !isAuth && !isFresh;
  });

  checkGate();
}

// --- 5. LLM Integration (Unified) ---
function getLLMConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) || {};
  } catch {
    return {};
  }
}

async function* askLLM(history) {
  const { asyncLLM } = await load('llm');
  const cfg = getLLMConfig();
  
  if (!cfg.baseUrl) throw new Error("Please configure LLM settings first.");

  const model = $('#model').value || cfg.models?.[0] || 'gpt-4o-mini';
  const systemPrompt = $('#system-prompt').value || state.config.systemPrompt;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`
  };
  
  const body = {
    model,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...history]
  };

  try {
    // Attempt Streaming
    for await (const chunk of asyncLLM(url, { method: 'POST', headers, body: JSON.stringify(body) })) {
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.content) yield chunk.content; // yield text chunk
    }
  } catch (e) {
    // Fallback to standard fetch if stream fails
    console.warn("Stream failed, falling back to fetch", e);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream: false })
    });
    const data = await res.json();
    yield data.choices?.[0]?.message?.content || "";
  }
}

// --- 6. UI & Chat Rendering ---
async function renderMD(text) {
  try {
    const { marked } = await load('md');
    return marked.parse(text || '');
  } catch {
    return (text || '').replace(/\n/g, '<br>');
  }
}

function appendMsg(role, text, isLoading = false) {
  const chatBox = $('#chat');
  const div = document.createElement('div');
  
  div.className = `chat-msg-wrap ${role === 'user' ? 'msg-user text-end' : 'msg-ai'}`;
  
  const header = role === 'ai' 
    ? '<i class="bi bi-cpu-fill"></i> Advisor' 
    : 'You <i class="bi bi-person-circle"></i>';
    
  const content = isLoading 
    ? '<div class="spinner-grow spinner-grow-sm"></div><div class="spinner-grow spinner-grow-sm mx-1"></div>' 
    : '<div class="markdown-body"></div>';

  div.innerHTML = `<small class="text-muted">${header}</small>
                   <div class="bubble p-2 rounded-3 d-inline-block text-start">${content}</div>`;
                    
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;

  // Render Markdown async if text is present
  if (!isLoading && text) {
    renderMD(text).then(html => div.querySelector('.markdown-body').innerHTML = html);
  }
  
  return div.querySelector('.bubble');
}

async function handleTurn(input) {
  if (!input) return;
  const cfg = getLLMConfig();
  if (!cfg.baseUrl) { showAlert('warning', 'Please configure LLM settings first.'); setLoading(false); return; }
  $('#user-input').value = '';

  // 1. User Turn
  state.msgs.push({ role: 'user', content: input });
  appendMsg('user', input);
  
  if (state.session) {
    sbClient.from('chat_messages').insert({ 
      session_id: state.session.id, role: 'user', content: input 
    });
  }

  // 2. AI Turn (Streaming)
  setLoading(true);
  const bubble = appendMsg('ai', '', true);
  let fullResponse = '';

  try {
    for await (const chunk of askLLM(state.msgs)) {
      const text = String(chunk);
      // If stream sends cumulative content, replace; else append
      if (text.startsWith(fullResponse)) fullResponse = text; else fullResponse += text;
      bubble.innerHTML = `<div class="markdown-body">${await renderMD(fullResponse)}</div>`;
      $('#chat').scrollTop = $('#chat').scrollHeight;
    }
    
    // 3. Save AI Response
    state.msgs.push({ role: 'assistant', content: fullResponse });
    if (state.session) {
      sbClient.from('chat_messages').insert({ 
        session_id: state.session.id, role: 'ai', content: fullResponse 
      });
    }
  } catch (e) {
    bubble.innerHTML = `<span class="text-danger">Error: ${e.message}</span>`;
    showAlert('danger', `LLM error: ${e.message}`);
  }
  
  setLoading(false);
}

// --- 7. Game Logic ---
async function startGame(demoId) {
  if (!state.user && demoId !== '__fresh__') { showAlert('warning', 'Please sign in to start a scenario.'); return; }

  state.msgs = [];
  state.session = null;
  state.isFresh = demoId === '__fresh__';
  $('#chat').innerHTML = '';

  if (demoId !== '__fresh__') {
    const demo = state.config.demos?.find(d => d.id === demoId);
    // Create Session in DB
    const { data } = await sbClient.from('game_sessions')
      .insert({ user_id: state.user.id }).select().single();
      
    state.session = data;
    
    // Inject Prompt (Invisible to user initially, but sent to LLM)
    handleTurn(demo?.prompt || "Start the scenario.");
  } else {
    // Fresh Chat mode
    checkGate();
    $('#user-input').focus();
  }
}

function renderDemos() {
  const row = $('#demo-cards .row');
  if (!row) return;
  
  // Render Configured Demos
  const cards = (state.config.demos || []).map(d => `
    <div class="col-md-4 col-lg-3">
      <div class="card h-100" data-id="${d.id}">
        <div class="card-body d-flex flex-column text-center">
          <i class="fs-1 text-primary bi ${d.icon} mb-3"></i>
          <h5>${d.title}</h5>
          <p class="small text-muted">${d.desc}</p>
          <button class="btn btn-primary mt-auto w-100 start-demo" disabled>Start</button>
        </div>
      </div>
    </div>
  `).join('');

  // Render "Fresh Chat" Card
  const freshCard = `
    <div class="col-md-4 col-lg-3">
      <div class="card h-100" data-id="__fresh__">
        <div class="card-body d-flex flex-column text-center">
          <i class="fs-1 text-success bi bi-lightning-charge-fill mb-3"></i>
          <h5>Start Fresh</h5>
          <p class="small text-muted">Free-form chat with the advisor.</p>
          <button class="btn btn-success mt-auto w-100 start-demo">Start</button>
        </div>
      </div>
    </div>`;

  row.innerHTML = cards + freshCard;
}

// --- 8. Event Handling & Helpers ---
const setLoading = (isDisabled) => {
  $('#user-input').disabled = isDisabled;
  $('#send-btn').disabled = isDisabled;
};

const checkGate = () => {
  const hasConfig = !!getLLMConfig().baseUrl;
  const isChatActive = state.msgs.length > 0 || !!state.session || $('#chat').children.length > 0;
  
  // Allow typing in Fresh mode; else require config + active chat
  const canType = state.isFresh || (hasConfig && isChatActive);
  setLoading(!canType);
};

// Global Event Listener (Delegation)
document.addEventListener('click', async (e) => {
  const target = e.target;

  // Start Demo Button
  if (target.closest('.start-demo')) {
    startGame(target.closest('.card').dataset.id);
  }

  // Configure LLM Button
  if (target.closest('#configure-llm')) {
    try {
      if (!state.user) showAlert('warning', 'Sign in to save LLM settings.');
      const { openaiConfig } = await load('ui'); const prev=getLLMConfig().baseUrl,prevK=getLLMConfig().apiKey; await openaiConfig({ show: true }); checkGate(); const next=getLLMConfig().baseUrl,nextK=getLLMConfig().apiKey; if(next && (next!==prev || nextK!==prevK)) showAlert('success','LLM configured');
    } catch { }
  }

  // Auth: Sign In
  if (target.closest('#auth-btn')) {
    try {
      const popup = await load('auth');
      await popup.default(sbClient, { provider: 'google' });
    } catch {
      // Fallback if popup blocker or script fail
      sbClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } })
        .catch(() => showAlert('danger', 'Sign in failed.'));
    }
  }

  // Auth: Sign Out
  if (target.closest('#signout-btn')) {
    await sbClient.auth.signOut();
  }

  // Profile: Load Sessions
  if (target.closest('#profile-btn')) {
    const modal = new bootstrap.Modal($('#profile-modal'));
    modal.show();
    const list = $('#session-list');
    const messagesBox = $('#session-messages');
    list.innerHTML = "<div class='p-3 text-center'>Loading...</div>";
    messagesBox.innerHTML = '';

    const { data } = await sbClient.from('game_sessions')
      .select('*').order('created_at', { ascending: false });

    list.innerHTML = '';
    state.selectedSession = null;
    $('#continue-session').disabled = true;
    $('#delete-session').disabled = true;
    
    // Render History List
    (data || []).forEach(sess => {
      const btn = document.createElement('button');
      btn.className = 'list-group-item list-group-item-action small';
      btn.innerText = `Session ${sess.id.slice(0, 8)} (${new Date(sess.created_at).toLocaleString()})`;
      
      btn.onclick = async () => {
        state.selectedSession = sess;
        const { data: msgs } = await sbClient.from('chat_messages')
          .select('*').eq('session_id', sess.id).order('created_at');
          
        // Preview in modal right pane
        messagesBox.innerHTML = '';
        (msgs || []).forEach(m => {
          const bubble = document.createElement('div');
          bubble.className = `chat-msg-wrap ${m.role === 'ai' ? 'msg-ai' : 'msg-user text-end'}`;
          bubble.innerHTML = `<small class=\"text-muted\">${m.role === 'ai' ? '<i class=\"bi bi-cpu-fill\"></i> Advisor' : 'You <i class=\"bi bi-person-circle\"></i>'}</small>
                              <div class=\"bubble p-2 rounded-3 d-inline-block text-start\">${m.content}</div>`;
          messagesBox.appendChild(bubble);
        });
        $('#continue-session').disabled = false;
        $('#delete-session').disabled = false;
      };
      list.appendChild(btn);
    });

    // Continue: restore chat and close modal
    $('#continue-session').onclick = async () => {
      if (!state.selectedSession) return;
      state.session = state.selectedSession;
      const { data: msgs } = await sbClient.from('chat_messages')
        .select('*').eq('session_id', state.session.id).order('created_at');
      $('#chat').innerHTML = '';
      state.msgs = [];
      (msgs || []).forEach(m => {
        state.msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content });
        appendMsg(m.role, m.content);
      });
      checkGate();
      bootstrap.Modal.getInstance($('#profile-modal')).hide();
    };

    // Delete session (and its messages)
    $('#delete-session').onclick = async () => {
      if (!state.selectedSession) return;
      await sbClient.from('chat_messages').delete().eq('session_id', state.selectedSession.id);
      await sbClient.from('game_sessions').delete().eq('id', state.selectedSession.id);
      showAlert('info', 'Session deleted.');
      bootstrap.Modal.getInstance($('#profile-modal')).hide();
    };
  }
});

// Input Handling
const handleSendClick = (e) => {
  e.preventDefault();
  handleTurn($('#user-input').value.trim());
};

$('#send-btn').addEventListener('click', handleSendClick);
$('#user-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendClick(e);
});

// Start
window.addEventListener('load', init);





