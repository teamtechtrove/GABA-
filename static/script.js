'use strict';
/* ============================================================
   GABA v3.0 — frontend wired to Flask backend
   ============================================================ */

// ===== state =====
const CFG_KEY = 'gaba_cfg_v3';
const SID_KEY = 'gaba_sid_v3';
const CONV_PREFIX = 'gaba_conv_v3_';

let cfg = { stream: true, autoSave: true, compact: false };
let conversation = [];
let currentSid = localStorage.getItem(SID_KEY) || newSid();
let isTyping = false;
let auth = { loggedIn: false, email: '' };
let adminLoggedIn = false;
let providerOrderCache = ['groq','openai','claude','gemini','deepseek'];

// ===== bootstrap =====
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  loadCfg();
  applyBodyClasses();
  initCanvas();
  restoreSession();
  renderHistory();
  localStorage.setItem(SID_KEY, currentSid);
  fetchAuthMe();
  bindInput();
  bindAdminHotspot();
  bindModalDismiss();
  initVoice();
});

function loadCfg(){
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch(_){}
}
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function applyBodyClasses(){
  document.body.classList.toggle('compact', !!cfg.compact);
}
function newSid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// ===== background canvas (subtle drifting particles) =====
function initCanvas(){
  const c = $('bgCanvas'); if (!c) return;
  const ctx = c.getContext('2d');
  let w, h, particles = [];
  function resize(){
    w = c.width = window.innerWidth;
    h = c.height = window.innerHeight;
    const count = Math.min(70, Math.floor((w*h)/22000));
    particles = Array.from({length: count}, () => ({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*.18, vy: (Math.random()-.5)*.18,
      r: Math.random()*1.6 + .4,
      hue: Math.random() < .5 ? 260 : (Math.random()<.5 ? 290 : 150),
    }));
  }
  function tick(){
    ctx.clearRect(0,0,w,h);
    for (const p of particles){
      p.x += p.vx; p.y += p.vy;
      if (p.x<0) p.x=w; if (p.x>w) p.x=0;
      if (p.y<0) p.y=h; if (p.y>h) p.y=0;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, .55)`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    // soft connecting lines
    for (let i=0;i<particles.length;i++){
      for (let j=i+1;j<particles.length;j++){
        const a = particles[i], b = particles[j];
        const dx = a.x-b.x, dy = a.y-b.y;
        const d2 = dx*dx + dy*dy;
        if (d2 < 14000){
          ctx.strokeStyle = `rgba(108,71,255,${.10 * (1 - d2/14000)})`;
          ctx.lineWidth = .6;
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        }
      }
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', resize);
  resize(); tick();
}

// ===== textarea =====
function bindInput(){
  const ta = $('userInput'), cc = $('charCount');
  ta.addEventListener('input', () => {
    cc.textContent = ta.value.length;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
  });
}

// ===== toast =====
function showToast(msg, type=''){
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, 2400);
  setTimeout(() => t.remove(), 2700);
}

// ===== send =====
async function sendMessage(){
  const ta = $('userInput');
  const msg = ta.value.trim();
  if (!msg || isTyping) return;

  isTyping = true;
  $('sendBtn').disabled = true;
  ta.value = ''; ta.style.height = 'auto';
  $('charCount').textContent = '0';

  appendMsg(msg, 'user');
  $('welcomeScreen').style.display = 'none';
  conversation.push({ role:'user', content: msg });

  $('typingBar').classList.add('on');
  document.querySelector('.live-dot')?.classList.add('thinking');
  $('modelLabel').textContent = 'THINKING';
  scrollChat();

  try {
    const res = await fetch('/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg, history: conversation.slice(-30) }),
    });
    const data = await res.json();
    const reply = data.reply || 'No response.';
    const provider = data.provider || 'gaba';
    appendMsg(reply, 'bot', provider);
    conversation.push({ role:'assistant', content: reply });
    if (cfg.autoSave) localStorage.setItem(CONV_PREFIX + currentSid, JSON.stringify(conversation));
    renderHistory();
    $('modelLabel').textContent = provider.toUpperCase();
  } catch (e){
    appendMsg('Network error — please try again.', 'bot', 'err');
    $('modelLabel').textContent = 'ERROR';
  } finally {
    $('typingBar').classList.remove('on');
    document.querySelector('.live-dot')?.classList.remove('thinking');
    isTyping = false;
    $('sendBtn').disabled = false;
    ta.focus();
  }
}

// ===== render =====
function appendMsg(text, role, provider=null){
  const msgs = $('messages');
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const av = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = role === 'user' ? (auth.email ? auth.email[0].toUpperCase() : 'Y') : '⚡';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const who = role === 'user' ? 'You' : 'GABA';
  const time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  meta.innerHTML = `<span>${who} · ${time}</span>`;
  if (provider && role === 'bot'){
    let cls = '';
    if (provider === 'safety') cls = 'safe';
    else if (provider === 'err' || provider === 'error') cls = 'err';
    meta.innerHTML += `<span class="prov-badge ${cls}">${esc(provider)}</span>`;
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = formatMsg(text);
  addCopyButtons(bubble);

  body.appendChild(meta);
  body.appendChild(bubble);
  row.appendChild(av);
  row.appendChild(body);
  msgs.appendChild(row);
  scrollChat();
}

function renderAll(){
  $('messages').innerHTML = '';
  for (const t of conversation){
    if (t.role === 'user') appendMsg(t.content, 'user');
    else if (t.role === 'assistant') appendMsg(t.content, 'bot');
  }
}

function addCopyButtons(bubble){
  bubble.querySelectorAll('pre').forEach(pre => {
    if (pre.parentNode.classList?.contains('code-wrapper')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code-wrapper';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1800);
      });
    };
    wrap.appendChild(btn);
  });
}

// ===== markdown formatter =====
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function formatMsg(t){
  if (!t) return '';
  // Code blocks first (preserve raw content)
  const codeBlocks = [];
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.push(`<pre><code class="lang-${lang || 'text'}">${esc(code.replace(/\n$/,''))}</code></pre>`) - 1;
    return `\u0000CB${i}\u0000`;
  });
  // Inline code
  const inlines = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => {
    const i = inlines.push(`<code>${esc(c)}</code>`) - 1;
    return `\u0000IC${i}\u0000`;
  });
  // Escape rest
  t = esc(t);
  // Headers
  t = t.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  t = t.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  t = t.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold / italic
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Blockquote
  t = t.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  // Lists
  t = t.replace(/^[*-]\s+(.+)$/gm, '<li>$1</li>');
  t = t.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  t = t.replace(/(<li>[\s\S]*?<\/li>(?:\n<li>[\s\S]*?<\/li>)*)/g, '<ul>$1</ul>');
  // URLs
  t = t.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  // Newlines
  t = t.replace(/\n/g, '<br>');
  t = t.replace(/<br>(<(?:pre|ul|ol|table|blockquote|h[1-6]))/g, '$1');
  t = t.replace(/(<\/(?:pre|ul|ol|table|blockquote|h[1-6])>)<br>/g, '$1');
  // Restore inline code, then code blocks
  t = t.replace(/\u0000IC(\d+)\u0000/g, (_, i) => inlines[+i]);
  t = t.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[+i]);
  return t;
}

function scrollChat(){
  const ca = $('chatArea');
  ca.scrollTo({ top: ca.scrollHeight, behavior:'smooth' });
}

// ===== chat ops =====
function newChat(){
  conversation = [];
  currentSid = newSid();
  localStorage.setItem(SID_KEY, currentSid);
  $('messages').innerHTML = '';
  $('welcomeScreen').style.display = 'flex';
  $('modelLabel').textContent = 'READY';
  $('userInput').value = ''; $('userInput').style.height = 'auto'; $('charCount').textContent = '0';
  renderHistory();
  showToast('New conversation started');
  $('userInput').focus();
  if (window.innerWidth <= 768) closeSidebar();
}

function clearChat(){
  if (!conversation.length) { showToast('Nothing to clear.'); return; }
  if (!confirm('Clear this conversation?')) return;
  conversation = [];
  localStorage.removeItem(CONV_PREFIX + currentSid);
  $('messages').innerHTML = '';
  $('welcomeScreen').style.display = 'flex';
  $('modelLabel').textContent = 'READY';
  renderHistory();
  showToast('Chat cleared');
}

function exportChat(){
  if (!conversation.length){ showToast('Nothing to export.', 'error'); return; }
  const lines = conversation.map(t => `[${t.role.toUpperCase()}]\n${t.content}\n`).join('\n---\n\n');
  const blob = new Blob([`GABA Chat Export\n${'='.repeat(40)}\n\n${lines}`], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gaba_chat_${Date.now()}.txt`; a.click();
  URL.revokeObjectURL(url);
  showToast('Chat exported!', 'success');
}

function useSuggestion(text){
  const ta = $('userInput');
  ta.value = text; $('charCount').textContent = text.length;
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  ta.focus(); sendMessage();
}

function restoreSession(){
  try {
    const saved = JSON.parse(localStorage.getItem(CONV_PREFIX + currentSid) || '[]');
    if (saved.length){
      conversation = saved;
      $('welcomeScreen').style.display = 'none';
      renderAll();
    }
  } catch(_){ conversation = []; }
}

// ===== history panel =====
function toggleHistory(){
  const p = $('histPanel');
  p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
  if (p.style.display === 'block') renderHistory();
}

function renderHistory(){
  const list = $('histList'); if (!list) return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (k && k.startsWith(CONV_PREFIX)) keys.push(k);
  }
  list.innerHTML = '';
  if (!keys.length){
    list.innerHTML = '<div class="hist-empty">No saved chats</div>';
    return;
  }
  keys.slice().reverse().slice(0, 12).forEach(key => {
    try {
      const turns = JSON.parse(localStorage.getItem(key) || '[]');
      const preview = turns.find(t => t.role === 'user')?.content?.slice(0, 38) || key;
      const div = document.createElement('div');
      div.className = 'hist-item';
      div.textContent = preview + (preview.length >= 38 ? '…' : '');
      div.title = 'Load this chat';
      div.onclick = () => loadChat(key);
      list.appendChild(div);
    } catch(_){}
  });
}

function loadChat(key){
  try {
    const data = JSON.parse(localStorage.getItem(key) || '[]');
    conversation = data;
    currentSid = key.replace(CONV_PREFIX, '');
    localStorage.setItem(SID_KEY, currentSid);
    $('messages').innerHTML = '';
    $('welcomeScreen').style.display = data.length ? 'none' : 'flex';
    renderAll();
    showToast('Conversation loaded', 'success');
    if (window.innerWidth <= 768) closeSidebar();
  } catch(_){ showToast('Failed to load', 'error'); }
}

// ===== sidebar =====
function toggleSidebar(){
  const s = $('sidebar'), o = $('sOverlay');
  const open = s.classList.toggle('open');
  o.style.display = open ? 'block' : 'none';
}
function closeSidebar(){
  $('sidebar').classList.remove('open');
  $('sOverlay').style.display = 'none';
}

// ===== voice =====
let recognition = null;
function initVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.onresult = e => {
    const t = e.results[0][0].transcript;
    const ta = $('userInput');
    ta.value = t; $('charCount').textContent = t.length;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    sendMessage();
  };
  recognition.onerror = () => showToast('Voice not recognized.', 'error');
}
function startVoice(){
  if (recognition){ recognition.start(); showToast('Listening…'); }
  else showToast('Voice not supported in this browser.', 'error');
}

// ===== settings modal =====
function openSettings(){
  $('streamToggle').checked = !!cfg.stream;
  $('autoSaveToggle').checked = !!cfg.autoSave;
  $('compactToggle').checked = !!cfg.compact;
  $('settingsModal').classList.add('open');
}
function closeSettings(){ $('settingsModal').classList.remove('open'); }
function saveSettings(){
  cfg.stream = $('streamToggle').checked;
  cfg.autoSave = $('autoSaveToggle').checked;
  cfg.compact = $('compactToggle').checked;
  saveCfg();
  applyBodyClasses();
  closeSettings();
  showToast('Settings saved!', 'success');
}

// ===== auth (Flask + Supabase) =====
async function fetchAuthMe(){
  try {
    const r = await fetch('/auth/me');
    if (r.ok){
      const d = await r.json();
      auth.loggedIn = !!d.logged_in;
      auth.email = d.email || '';
      $('authNavLabel').textContent = auth.loggedIn ? (auth.email ? auth.email.split('@')[0] : 'Account') : 'Account';
    }
  } catch(_){}
}
function openAuth(){
  updateAuthUI();
  $('authModal').classList.add('open');
  if (window.innerWidth <= 768) closeSidebar();
}
function closeAuth(){ $('authModal').classList.remove('open'); }
function updateAuthUI(){
  const status = $('authStatus');
  const form = $('authFormWrap');
  const logged = $('authLoggedWrap');
  const emailDisp = $('authEmailDisplay');
  if (auth.loggedIn){
    status.textContent = 'You are signed in.';
    form.style.display = 'none';
    logged.style.display = 'block';
    emailDisp.textContent = auth.email;
  } else {
    status.textContent = 'Sign in to sync your conversations.';
    form.style.display = 'block';
    logged.style.display = 'none';
  }
}
async function doLogin(){
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password){ showToast('Email and password required.', 'error'); return; }
  try {
    const r = await fetch('/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (r.ok && d.status === 'ok'){
      auth = { loggedIn:true, email: d.email || email };
      $('authNavLabel').textContent = (d.email || email).split('@')[0];
      updateAuthUI();
      showToast('Logged in!', 'success');
      closeAuth();
    } else {
      showToast(d.error || 'Login failed.', 'error');
    }
  } catch(_){ showToast('Network error.', 'error'); }
}
async function doSignup(){
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password || password.length < 8){
    showToast('Email and 8+ char password required.', 'error'); return;
  }
  try {
    const r = await fetch('/auth/signup', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (r.ok && (d.user || d.status === 'ok')){
      showToast('Account created! Please log in.', 'success');
    } else {
      showToast(d.error || 'Signup failed.', 'error');
    }
  } catch(_){ showToast('Network error.', 'error'); }
}
async function doLogout(){
  try {
    await fetch('/auth/logout', { method:'POST' });
    auth = { loggedIn:false, email:'' };
    $('authNavLabel').textContent = 'Account';
    updateAuthUI();
    showToast('Logged out.');
    closeAuth();
  } catch(_){ showToast('Logout failed.', 'error'); }
}

// ===== admin (visible lock button trigger) =====
const ALL_PROVIDERS = ['groq','openai','claude','gemini','deepseek'];
let adminTab = 'dashboard';
let adminCache = { stats:null, keys:[], order:[], settings:null, prompt:null, users:[], conversations:[] };

function bindAdminHotspot(){ /* deprecated; kept for backward bootstrap call */ }

function closeAdmin(){ $('adminPanel').style.display = 'none'; }
async function openAdmin(){
  $('adminPanel').style.display = 'flex';
  try {
    const r = await fetch('/admin/stats');
    if (r.ok) adminLoggedIn = true;
  } catch(_){}
  await renderAdminContent();
}

function adminTabs(active){
  const tabs = [
    ['dashboard','Dashboard'],['keys','Keys'],['providers','Providers'],
    ['settings','Settings'],['prompt','Prompt'],['users','Users'],
    ['conversations','Chats'],['backup','Backup'],['password','Password'],
  ];
  return `<div class="adm-tabs">${tabs.map(([id,label]) =>
    `<button class="adm-tab${active===id?' active':''}" onclick="setAdminTab('${id}')">${label}</button>`
  ).join('')}</div>`;
}

async function setAdminTab(id){ adminTab = id; await renderAdminContent(); }

async function renderAdminContent(){
  const body = $('adminBody');

  if (!adminLoggedIn){
    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-section-title">🔑 Admin Login</div>
        <input type="password" id="adminPwdInp" class="inp" placeholder="Admin password" autocomplete="off" style="margin-bottom:10px">
        <div id="adminLoginErr" style="color:var(--kill);font-size:11px;font-family:var(--mono);margin-bottom:8px;min-height:14px"></div>
        <button class="btn btn-primary" onclick="attemptAdminLogin()">Unlock Console</button>
      </div>
    `;
    $('adminPwdInp').addEventListener('keydown', e => { if (e.key === 'Enter') attemptAdminLogin(); });
    setTimeout(() => $('adminPwdInp')?.focus(), 50);
    return;
  }

  body.innerHTML = adminTabs(adminTab) + `<div id="admTabBody"></div>`;

  switch (adminTab){
    case 'dashboard':     return renderTabDashboard();
    case 'keys':          return renderTabKeys();
    case 'providers':     return renderTabProviders();
    case 'settings':      return renderTabSettings();
    case 'prompt':        return renderTabPrompt();
    case 'users':         return renderTabUsers();
    case 'conversations': return renderTabConversations();
    case 'backup':        return renderTabBackup();
    case 'password':      return renderTabPassword();
  }
}

// ---------- Dashboard ----------
async function renderTabDashboard(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  let stats = {};
  try { stats = await fetch('/admin/stats').then(r=>r.json()); } catch(_){}
  adminCache.stats = stats;
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">📊 Live System Stats</div>
      <div class="stat-row"><span>Conversations</span><span class="stat-val">${stats.total_conversations ?? '—'}</span></div>
      <div class="stat-row"><span>Active API keys</span><span class="stat-val">${stats.active_api_keys ?? '—'}</span></div>
      <div class="stat-row"><span>Total users</span><span class="stat-val">${stats.total_users ?? '—'}</span></div>
      <div class="stat-row"><span>Rate-limited IPs</span><span class="stat-val">${stats.rate_limited_ips ?? 0}</span></div>
      <div class="btn-row-tight">
        <button class="adm-mini" onclick="renderTabDashboard()">↻ Refresh</button>
        <button class="adm-mini danger" onclick="clearRateLimit()">Clear rate-limit cache</button>
        <button class="adm-mini" onclick="adminLogout()">Sign out</button>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">⚡ Quick Provider Test</div>
      <p style="font-size:11px;color:var(--chalk-4);font-family:var(--mono);margin-bottom:8px">Send a probe message through any provider and see latency + reply.</p>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <select id="quickTestProv" class="inp" style="flex:1;cursor:pointer">
          ${ALL_PROVIDERS.map(p=>`<option value="${p}">${p}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="quickTestProvider()" style="white-space:nowrap">Run Test</button>
      </div>
      <div id="quickTestOut" class="adm-test-out" style="display:none"></div>
    </div>`;
}

async function clearRateLimit(){
  try {
    const r = await fetch('/admin/clear_rate_limit', {method:'POST'});
    const d = await r.json();
    showToast(`Cleared ${d.cleared ?? 0} IP entries`, 'success');
    renderTabDashboard();
  } catch(_){ showToast('Failed', 'error'); }
}

async function quickTestProvider(){
  const provider = $('quickTestProv').value;
  const out = $('quickTestOut');
  out.style.display = 'block';
  out.className = 'adm-test-out';
  out.textContent = `Testing ${provider}…`;
  try {
    const r = await fetch('/admin/test_provider', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ provider })
    });
    const d = await r.json();
    if (d.ok){
      out.className = 'adm-test-out ok';
      out.textContent = `✅ ${provider} · ${d.latency_ms}ms\n\n${d.reply}`;
    } else {
      out.className = 'adm-test-out fail';
      out.textContent = `❌ ${provider} · ${d.latency_ms ?? '—'}ms\n\n${d.error || 'Unknown error'}`;
    }
  } catch(e){
    out.className = 'adm-test-out fail';
    out.textContent = `Network error: ${e.message}`;
  }
}

// ---------- Keys ----------
async function renderTabKeys(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  let keys = [];
  try { keys = await fetch('/admin/api_keys').then(r=>r.json()); } catch(_){}
  adminCache.keys = keys;
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">🔑 Stored API Keys</div>
      <ul class="adm-list" id="keyListAdmin"></ul>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">＋ Add / Replace Key</div>
      <div class="field" style="margin-bottom:6px">
        <select id="newProvInp" class="inp" style="margin-bottom:6px;cursor:pointer">
          ${ALL_PROVIDERS.map(p=>`<option value="${p}">${p}</option>`).join('')}
        </select>
        <input id="newKeyInp" class="inp" placeholder="API key value" type="password">
      </div>
      <button class="btn btn-primary" onclick="addAdminKey()">Save Key</button>
      <p style="font-size:10.5px;color:var(--chalk-4);font-family:var(--mono);margin-top:8px;line-height:1.6">Adding a key for a provider deactivates older keys for the same provider.</p>
    </div>`;
  const keyList = $('keyListAdmin');
  if (!keys.length){
    keyList.innerHTML = '<div class="adm-empty">No keys stored yet.</div>';
  } else {
    keys.forEach(k => {
      const li = document.createElement('li');
      li.className = 'adm-list-item';
      const masked = k.api_key_masked || '••••';
      li.innerHTML = `
        <span class="adm-pill prov">${esc(k.provider)}</span>
        <span style="flex:1;color:var(--chalk-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(masked)}</span>
        <span class="adm-pill ${k.is_active === false ? 'off' : 'on'}">${k.is_active === false ? 'OFF' : 'ON'}</span>
        <button class="adm-mini" data-prov="${esc(k.provider)}" data-act="test">Test</button>
        <button class="adm-mini danger" data-prov="${esc(k.provider)}" data-id="${k.id ?? ''}" data-act="del">Delete</button>
      `;
      keyList.appendChild(li);
    });
    keyList.querySelectorAll('button[data-act="del"]').forEach(b => b.onclick = () => deleteAdminKey(b.dataset.prov, b.dataset.id));
    keyList.querySelectorAll('button[data-act="test"]').forEach(b => b.onclick = async () => {
      b.textContent = '…'; b.disabled = true;
      try {
        const r = await fetch('/admin/test_provider', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ provider: b.dataset.prov })
        });
        const d = await r.json();
        showToast(d.ok ? `✓ ${d.provider} (${d.latency_ms}ms)` : `✗ ${d.provider}: ${(d.error||'fail').slice(0,60)}`, d.ok?'success':'error');
      } catch(_){ showToast('Network error', 'error'); }
      b.textContent = 'Test'; b.disabled = false;
    });
  }
}

// ---------- Providers (priority + enable/disable) ----------
async function renderTabProviders(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  let order = ALL_PROVIDERS, settings = {};
  try {
    const [o, s] = await Promise.all([
      fetch('/admin/provider_order').then(r=>r.json()),
      fetch('/admin/settings').then(r=>r.json()),
    ]);
    if (Array.isArray(o)) order = o; else if (o && Array.isArray(o.order)) order = o.order;
    settings = s || {};
  } catch(_){}
  // ensure all known providers appear
  for (const p of ALL_PROVIDERS) if (!order.includes(p)) order.push(p);
  providerOrderCache = order;
  const disabled = new Set(settings.disabled_providers || []);

  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">⚙️ Fallback Order &amp; Toggles</div>
      <p style="font-size:11px;color:var(--chalk-4);font-family:var(--mono);margin-bottom:10px;line-height:1.6">Drag the handle to reorder. Use the toggle to skip a provider entirely.</p>
      <ul class="adm-list" id="priorityAdmin"></ul>
      <div class="btn-row-tight">
        <button class="btn btn-primary" onclick="savePriorityAdmin()">Save Order &amp; Toggles</button>
        <button class="adm-mini" onclick="renderTabProviders()">↻ Reload</button>
      </div>
    </div>`;

  const priUl = $('priorityAdmin');
  let draggedEl = null;
  order.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'adm-list-item drag-item';
    li.draggable = true;
    li.dataset.provider = p;
    const isOff = disabled.has(p);
    li.innerHTML = `
      <span style="color:var(--chalk-4);font-family:var(--mono);font-size:11px;width:18px">${idx+1}</span>
      <span class="adm-pill prov">${esc(p)}</span>
      <span style="flex:1;color:var(--chalk-4);font-size:11px;font-family:var(--mono)">${isOff?'skipped':'in fallback chain'}</span>
      <label class="toggle-switch" title="Enable / disable">
        <input type="checkbox" data-tog="${esc(p)}" ${isOff?'':'checked'}>
        <span class="toggle-slider"></span>
      </label>
      <span style="color:var(--chalk-4);cursor:grab;padding:0 4px">⠿</span>
    `;
    li.addEventListener('dragstart', () => { draggedEl = li; li.classList.add('dragging'); });
    li.addEventListener('dragend',   () => { li.classList.remove('dragging'); draggedEl = null; });
    li.addEventListener('dragover',  e => {
      e.preventDefault();
      if (draggedEl && draggedEl !== li){
        const rect = li.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        priUl.insertBefore(draggedEl, after ? li.nextSibling : li);
      }
    });
    priUl.appendChild(li);
  });
}

async function savePriorityAdmin(){
  const items = [...document.querySelectorAll('#priorityAdmin .drag-item')];
  const order = items.map(li => li.dataset.provider);
  const disabled = items.filter(li => !li.querySelector('input[type=checkbox]').checked).map(li => li.dataset.provider);
  try {
    await Promise.all([
      fetch('/admin/provider_order', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({order})}),
      fetch('/admin/settings',       {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({disabled_providers: disabled})}),
    ]);
    providerOrderCache = order;
    showToast('Provider config saved.', 'success');
    renderTabProviders();
  } catch(_){ showToast('Failed to save.', 'error'); }
}

// ---------- Settings (feature toggles + rate limit) ----------
async function renderTabSettings(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  let s = {};
  try { s = await fetch('/admin/settings').then(r=>r.json()); } catch(_){}
  adminCache.settings = s;
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">🎛 Feature Toggles</div>
      <div class="adm-row">
        <div>
          <div class="adm-row-label">Web search tool</div>
          <div class="adm-row-sub">Allow GABA to perform DuckDuckGo searches</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="setWebSearch" ${s.feature_web_search?'checked':''}><span class="toggle-slider"></span></label>
      </div>
      <div class="adm-row">
        <div>
          <div class="adm-row-label">Open user sign-ups</div>
          <div class="adm-row-sub">When off, /auth/signup returns 403</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="setSignup" ${s.feature_signup_open?'checked':''}><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">⏱ Rate Limit</div>
      <div class="adm-row">
        <div>
          <div class="adm-row-label">Requests per minute / IP</div>
          <div class="adm-row-sub">Range 1–600. Excess returns 429.</div>
        </div>
        <input type="number" min="1" max="600" id="setRate" class="adm-num" value="${s.rate_limit_per_min ?? 30}">
      </div>
    </div>
    <div class="btn-row-tight">
      <button class="btn btn-primary" onclick="saveAdminSettings()">Save Settings</button>
      <button class="adm-mini" onclick="renderTabSettings()">↻ Reload</button>
    </div>`;
}

async function saveAdminSettings(){
  const payload = {
    feature_web_search:  $('setWebSearch').checked,
    feature_signup_open: $('setSignup').checked,
    rate_limit_per_min:  Number($('setRate').value) || 30,
  };
  try {
    const r = await fetch('/admin/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if (r.ok) showToast('Settings saved.', 'success');
    else showToast('Save failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

// ---------- System Prompt ----------
async function renderTabPrompt(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  let d = {};
  try { d = await fetch('/admin/system_prompt').then(r=>r.json()); } catch(_){}
  adminCache.prompt = d;
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">📜 Active System Prompt ${d.is_custom?'<span class="adm-pill prov" style="margin-left:6px">CUSTOM</span>':'<span class="adm-pill on" style="margin-left:6px">DEFAULT</span>'}</div>
      <p style="font-size:11px;color:var(--chalk-4);font-family:var(--mono);margin-bottom:10px;line-height:1.6">This is sent as the system message to every LLM call. Keep your safety rules intact.</p>
      <textarea id="promptEditor" class="adm-textarea" maxlength="8000">${esc(d.active || '')}</textarea>
      <div style="font-size:10.5px;color:var(--chalk-4);font-family:var(--mono);margin-top:6px;text-align:right"><span id="promptLen">${(d.active||'').length}</span> / 8000</div>
      <div class="btn-row-tight">
        <button class="btn btn-primary" onclick="savePrompt()">Save Custom Prompt</button>
        <button class="adm-mini danger" onclick="resetPrompt()">Reset to Default</button>
      </div>
    </div>`;
  $('promptEditor').addEventListener('input', e => $('promptLen').textContent = e.target.value.length);
}

async function savePrompt(){
  const prompt = $('promptEditor').value.trim();
  if (!prompt){ showToast('Prompt cannot be empty.', 'error'); return; }
  try {
    const r = await fetch('/admin/system_prompt', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt})});
    const d = await r.json();
    if (r.ok) { showToast('System prompt saved.', 'success'); renderTabPrompt(); }
    else showToast(d.error || 'Save failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}
async function resetPrompt(){
  if (!confirm('Reset system prompt to the built-in default?')) return;
  try {
    await fetch('/admin/system_prompt/reset', {method:'POST'});
    showToast('Reset to default.', 'success');
    renderTabPrompt();
  } catch(_){ showToast('Failed.', 'error'); }
}

// ---------- Users ----------
async function renderTabUsers(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading users…</div>`;
  let users = [];
  try { users = await fetch('/admin/users').then(r=>r.json()); } catch(_){}
  if (!Array.isArray(users)) users = [];
  adminCache.users = users;
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">👥 Users (${users.length})</div>
      <input type="text" id="userSearchInp" class="inp adm-search" placeholder="Filter by email…">
      <ul class="adm-list" id="userListAdmin"></ul>
      <div class="btn-row-tight">
        <button class="adm-mini" onclick="renderTabUsers()">↻ Refresh</button>
        <button class="adm-mini acid" onclick="exportData('users')">⬇ Export JSON</button>
      </div>
    </div>`;
  const listEl = $('userListAdmin');
  function paint(filter){
    const f = (filter||'').toLowerCase().trim();
    const rows = users.filter(u => !f || (u.email||'').toLowerCase().includes(f));
    if (!rows.length){ listEl.innerHTML = '<div class="adm-empty">No matching users.</div>'; return; }
    listEl.innerHTML = '';
    rows.forEach(u => {
      const li = document.createElement('li');
      li.className = 'adm-list-item';
      const date = (u.created_at||'').split('T')[0] || '—';
      li.innerHTML = `
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--chalk-2)">${esc(u.email||'(no email)')}</span>
        <span class="adm-pill prov">${u.conv_count ?? 0} chats</span>
        <span style="color:var(--chalk-4);font-size:10px;font-family:var(--mono)">${esc(date)}</span>
        <button class="adm-mini danger" data-id="${esc(u.id||'')}" data-email="${esc(u.email||'')}">Delete</button>
      `;
      listEl.appendChild(li);
    });
    listEl.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => deleteUser(b.dataset.id, b.dataset.email));
  }
  $('userSearchInp').addEventListener('input', e => paint(e.target.value));
  paint('');
}

async function deleteUser(id, email){
  if (!id) return showToast('Missing user id.', 'error');
  if (!confirm(`Delete user ${email}? This removes their account and all their conversations.`)) return;
  try {
    const r = await fetch('/admin/users/' + encodeURIComponent(id), {method:'DELETE'});
    const d = await r.json();
    if (r.ok){ showToast(`Deleted user (${d.conversations_deleted} chats).`, 'success'); renderTabUsers(); }
    else showToast(d.error || 'Delete failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

// ---------- Conversations ----------
async function renderTabConversations(){
  const tb = $('admTabBody');
  tb.innerHTML = `<div class="adm-empty">Loading…</div>`;
  await loadConversations('');
}
async function loadConversations(q){
  let rows = [];
  try {
    const url = '/admin/conversations?limit=80' + (q ? '&q=' + encodeURIComponent(q) : '');
    rows = await fetch(url).then(r=>r.json());
    if (!Array.isArray(rows)) rows = [];
  } catch(_){}
  adminCache.conversations = rows;
  const tb = $('admTabBody');
  tb.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">💬 Recent Conversations (${rows.length})</div>
      <input type="text" id="convSearchInp" class="inp adm-search" placeholder="Search messages or replies…" value="${esc(q||'')}">
      <div id="convListAdmin"></div>
      <div class="btn-row-tight">
        <button class="adm-mini" onclick="loadConversations('')">↻ Reload</button>
        <button class="adm-mini acid" onclick="exportData('conversations')">⬇ Export JSON</button>
      </div>
    </div>`;
  let timer;
  $('convSearchInp').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => loadConversations(e.target.value), 350); });
  const list = $('convListAdmin');
  if (!rows.length){ list.innerHTML = '<div class="adm-empty">No conversations.</div>'; return; }
  rows.forEach(r => {
    const div = document.createElement('div');
    div.className = 'adm-conv';
    const t = (r.created_at||'').replace('T',' ').slice(0,16);
    div.innerHTML = `
      <div class="adm-conv-meta">
        <span><span class="adm-pill prov">${esc(r.provider_used||'?')}</span> &middot; ${esc(t)}</span>
        <button class="adm-mini danger" data-id="${esc(r.id||'')}">Delete</button>
      </div>
      <div class="adm-conv-msg"><strong style="color:var(--chalk-2)">U:</strong> ${esc((r.user_message||'').slice(0,300))}</div>
      <div class="adm-conv-reply"><strong style="color:var(--chalk-2)">G:</strong> ${esc((r.bot_reply||'').slice(0,300))}</div>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => deleteConversation(b.dataset.id));
}
async function deleteConversation(id){
  if (!id || !confirm('Delete this conversation log?')) return;
  try {
    const r = await fetch('/admin/conversations/' + encodeURIComponent(id), {method:'DELETE'});
    if (r.ok){ showToast('Deleted.', 'success'); loadConversations($('convSearchInp')?.value || ''); }
    else showToast('Delete failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

// ---------- Backup ----------
function renderTabBackup(){
  $('admTabBody').innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">💾 Project Backup</div>
      <p style="font-size:11.5px;color:var(--chalk-3);font-family:var(--mono);margin-bottom:12px;line-height:1.7">Bundle the full project (code + DB snapshots) into a ZIP and upload it to Supabase Storage and (if configured) push to GitHub.</p>
      <button class="btn btn-acid" onclick="runBackup()">Run Backup Now</button>
    </div>
    <div class="panel-section">
      <div class="panel-section-title">📤 Data Exports</div>
      <p style="font-size:11px;color:var(--chalk-4);font-family:var(--mono);margin-bottom:10px;line-height:1.6">Download as JSON for offline analysis.</p>
      <div class="btn-row-tight">
        <button class="adm-mini acid" onclick="exportData('users')">⬇ Users</button>
        <button class="adm-mini acid" onclick="exportData('conversations')">⬇ Conversations</button>
        <button class="adm-mini acid" onclick="exportData('settings')">⬇ Settings</button>
      </div>
    </div>`;
}

async function exportData(kind){
  showToast(`Exporting ${kind}…`);
  try {
    const r = await fetch('/admin/export/' + encodeURIComponent(kind));
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gaba_${kind}_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${kind}.`, 'success');
  } catch(_){ showToast('Export failed.', 'error'); }
}

// ---------- Password ----------
function renderTabPassword(){
  $('admTabBody').innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">🔐 Change Admin Password</div>
      <p style="font-size:11px;color:var(--chalk-4);font-family:var(--mono);margin-bottom:10px;line-height:1.6">A custom hashed password is stored in the database and overrides the env var until cleared.</p>
      <div class="field"><label>Current password</label><input type="password" id="pwdCurrent" class="inp" autocomplete="current-password"></div>
      <div class="field"><label>New password (8+ characters)</label><input type="password" id="pwdNew" class="inp" autocomplete="new-password"></div>
      <div class="field"><label>Confirm new password</label><input type="password" id="pwdConfirm" class="inp" autocomplete="new-password"></div>
      <button class="btn btn-primary" onclick="changeAdminPassword()">Update Password</button>
    </div>`;
}

async function changeAdminPassword(){
  const cur = $('pwdCurrent').value;
  const nw  = $('pwdNew').value;
  const cf  = $('pwdConfirm').value;
  if (!cur || !nw){ showToast('Fill in current and new password.', 'error'); return; }
  if (nw.length < 8){ showToast('New password must be 8+ characters.', 'error'); return; }
  if (nw !== cf){ showToast('New password and confirmation do not match.', 'error'); return; }
  try {
    const r = await fetch('/admin/change_password', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({current: cur, new: nw})});
    const d = await r.json();
    if (r.ok){ showToast('Password updated.', 'success'); $('pwdCurrent').value = $('pwdNew').value = $('pwdConfirm').value = ''; }
    else showToast(d.error || 'Update failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

async function attemptAdminLogin(){
  const pwd = $('adminPwdInp').value;
  try {
    const r = await fetch('/admin/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: pwd })
    });
    if (r.ok){
      adminLoggedIn = true;
      showToast('Admin access granted.', 'success');
      renderAdminContent();
    } else {
      $('adminLoginErr').textContent = 'Incorrect password.';
    }
  } catch(_){
    $('adminLoginErr').textContent = 'Network error.';
  }
}

async function addAdminKey(){
  const provider = $('newProvInp').value.trim().toLowerCase();
  const api_key  = $('newKeyInp').value.trim();
  if (!provider || !api_key){ showToast('Provider and key required.', 'error'); return; }
  try {
    const r = await fetch('/admin/api_keys', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ provider, api_key })
    });
    if (r.ok){ showToast(`Key for "${provider}" saved.`, 'success'); renderAdminContent(); }
    else showToast('Failed to save key.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

async function deleteAdminKey(provider, id){
  if (!id){ showToast('Missing key id.', 'error'); return; }
  if (!confirm(`Delete key for ${provider}?`)) return;
  try {
    const r = await fetch('/admin/api_keys', {
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id: Number(id) })
    });
    if (r.ok){ showToast(`Key for "${provider}" deleted.`); renderAdminContent(); }
    else showToast('Failed to delete.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

async function savePriorityAdmin(){
  const items = [...document.querySelectorAll('#priorityAdmin .drag-item')];
  const order = items.map(li => li.dataset.provider);
  try {
    const r = await fetch('/admin/provider_order', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ order })
    });
    if (r.ok){ providerOrderCache = order; showToast('Provider order saved.', 'success'); }
    else showToast('Failed to save order.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

async function runBackup(){
  showToast('Running backup…');
  try {
    const r = await fetch('/admin/backup', { method:'POST' });
    const d = await r.json();
    if (r.ok && !d.error) showToast('Backup complete!', 'success');
    else showToast((d.error || '').slice(0,80) || 'Backup failed.', 'error');
  } catch(_){ showToast('Network error.', 'error'); }
}

async function adminLogout(){
  try { await fetch('/admin/logout', { method:'POST' }); } catch(_){}
  adminLoggedIn = false;
  closeAdmin();
  showToast('Admin signed out.');
}

// ===== modal backdrop dismiss =====
function bindModalDismiss(){
  ['settingsModal','authModal'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });
}

// expose globals for inline onclicks
window.sendMessage = sendMessage;
window.useSuggestion = useSuggestion;
window.newChat = newChat;
window.clearChat = clearChat;
window.exportChat = exportChat;
window.toggleHistory = toggleHistory;
window.startVoice = startVoice;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.openAuth = openAuth;
window.closeAuth = closeAuth;
window.doLogin = doLogin;
window.doSignup = doSignup;
window.doLogout = doLogout;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.openAdmin = openAdmin;
window.closeAdmin = closeAdmin;
window.attemptAdminLogin = attemptAdminLogin;
window.addAdminKey = addAdminKey;
window.deleteAdminKey = deleteAdminKey;
window.savePriorityAdmin = savePriorityAdmin;
window.runBackup = runBackup;
window.adminLogout = adminLogout;
window.setAdminTab = setAdminTab;
window.renderTabDashboard = renderTabDashboard;
window.renderTabKeys = renderTabKeys;
window.renderTabProviders = renderTabProviders;
window.renderTabSettings = renderTabSettings;
window.renderTabPrompt = renderTabPrompt;
window.renderTabUsers = renderTabUsers;
window.renderTabConversations = renderTabConversations;
window.loadConversations = loadConversations;
window.deleteConversation = deleteConversation;
window.deleteUser = deleteUser;
window.savePrompt = savePrompt;
window.resetPrompt = resetPrompt;
window.saveAdminSettings = saveAdminSettings;
window.exportData = exportData;
window.changeAdminPassword = changeAdminPassword;
window.clearRateLimit = clearRateLimit;
window.quickTestProvider = quickTestProvider;
