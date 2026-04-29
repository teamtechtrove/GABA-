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

// ===== admin (hidden trigger: double-click bottom-left) =====
function bindAdminHotspot(){
  // Use both the explicit hotspot and a wider zone
  const hotspot = $('adminHotspot');
  if (hotspot) hotspot.addEventListener('dblclick', openAdmin);
  document.addEventListener('dblclick', e => {
    if (e.clientX < 80 && (window.innerHeight - e.clientY) < 80) openAdmin();
  });
}
function closeAdmin(){ $('adminPanel').style.display = 'none'; }
async function openAdmin(){
  $('adminPanel').style.display = 'flex';
  // Probe whether already-authed
  try {
    const r = await fetch('/admin/stats');
    if (r.ok){ adminLoggedIn = true; }
  } catch(_){}
  await renderAdminContent();
}

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

  // Fetch live data from backend
  let stats = {}, keys = [], order = providerOrderCache;
  try {
    const [s, k, o] = await Promise.all([
      fetch('/admin/stats').then(r => r.json()),
      fetch('/admin/api_keys').then(r => r.json()),
      fetch('/admin/provider_order').then(r => r.json()),
    ]);
    stats = s || {};
    keys = Array.isArray(k) ? k : ((k && k.keys) || []);
    if (Array.isArray(o)) { order = o; providerOrderCache = order; }
    else if (o && Array.isArray(o.order)) { order = o.order; providerOrderCache = order; }
  } catch(_){}

  body.innerHTML = `
    <div class="panel-section">
      <div class="panel-section-title">📊 System Stats</div>
      <div class="stat-row"><span>Conversations</span><span class="stat-val">${stats.total_conversations ?? '—'}</span></div>
      <div class="stat-row"><span>Active API keys</span><span class="stat-val">${stats.active_api_keys ?? keys.filter(k=>k.is_active).length}</span></div>
      <div class="stat-row"><span>Users</span><span class="stat-val">${stats.total_users ?? '—'}</span></div>
      <div class="stat-row"><span>Rate-limited IPs</span><span class="stat-val">${stats.rate_limited_ips ?? 0}</span></div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🔑 API Keys</div>
      <ul class="key-list" id="keyListAdmin"></ul>
      <div class="field" style="margin-bottom:6px">
        <select id="newProvInp" class="inp" style="margin-bottom:6px;cursor:pointer">
          <option value="groq">groq</option>
          <option value="openai">openai</option>
          <option value="claude">claude</option>
          <option value="gemini">gemini</option>
          <option value="deepseek">deepseek</option>
        </select>
        <input id="newKeyInp" class="inp" placeholder="API key value" type="password">
      </div>
      <button class="btn btn-primary" onclick="addAdminKey()">Add / Replace Key</button>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">⚙️ Provider Priority</div>
      <ul class="key-list" id="priorityAdmin"></ul>
      <button class="btn btn-primary" onclick="savePriorityAdmin()">Save Order</button>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">💾 Backup</div>
      <p style="font-size:11px;color:var(--chalk-3);font-family:var(--mono);margin-bottom:10px;line-height:1.6">
        Bundle this project into a ZIP and upload to Supabase Storage (and GitHub if configured).
      </p>
      <button class="btn btn-acid" onclick="runBackup()">Run Backup Now</button>
    </div>

    <div class="panel-section">
      <button class="btn btn-ghost" onclick="adminLogout()">Log Out of Admin</button>
    </div>
  `;

  // Render keys
  const keyList = $('keyListAdmin');
  if (!keys.length){
    keyList.innerHTML = '<li style="font-size:11px;color:var(--chalk-4);padding:4px 0;font-family:var(--mono)">No keys stored yet.</li>';
  }
  keys.forEach(k => {
    const li = document.createElement('li');
    li.className = 'key-item';
    const masked = k.api_key_masked || (k.api_key ? (k.api_key.slice(0,6)+'…'+k.api_key.slice(-4)) : '••••');
    li.innerHTML = `
      <span class="key-prov">${esc(k.provider)}</span>
      <span class="key-mask">${esc(masked)}</span>
      <span class="key-status">${k.is_active === false ? 'INACTIVE' : 'ACTIVE'}</span>
      <button class="key-del" data-prov="${esc(k.provider)}" data-id="${k.id ?? ''}">🗑</button>
    `;
    keyList.appendChild(li);
  });
  document.querySelectorAll('.key-del').forEach(btn => {
    btn.onclick = () => deleteAdminKey(btn.dataset.prov, btn.dataset.id);
  });

  // Drag-drop priority list
  const priUl = $('priorityAdmin');
  let draggedEl = null;
  order.forEach(p => {
    const li = document.createElement('li');
    li.className = 'key-item drag-item';
    li.draggable = true;
    li.dataset.provider = p;
    li.innerHTML = `<span class="key-prov">${esc(p)}</span><span class="key-mask">drag to reorder</span><span class="drag-handle">⠿</span>`;
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
