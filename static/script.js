// ========== GABA v3.0 Frontend ==========
let conversationHistory = [];
let currentSessionId = localStorage.getItem('sessionId') || Math.random().toString(36).substring(2);
localStorage.setItem('sessionId', currentSessionId);
let userLoggedIn = false;
let userEmail = '';

// DOM elements
const messagesDiv = document.getElementById('messages');
const welcomeScreen = document.getElementById('welcomeScreen');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const modelLabel = document.getElementById('modelLabel');
const historyListDiv = document.getElementById('historyList');
const charCountSpan = document.getElementById('charCount');
const authModal = document.getElementById('authModal');
const authStatus = document.getElementById('authStatus');
const authFormDiv = document.getElementById('authForm');
const authLoggedInDiv = document.getElementById('authLoggedIn');
const userEmailSpan = document.getElementById('userEmail');

// Load previous conversation from localStorage
let saved = localStorage.getItem(`gaba_conv_${currentSessionId}`);
if (saved) {
    try {
        conversationHistory = JSON.parse(saved);
        if (conversationHistory.length) {
            welcomeScreen.style.display = 'none';
            renderMessages();
        }
    } catch(e) {}
}

userInput.addEventListener('input', () => {
    charCountSpan.innerText = userInput.value.length;
    if (userInput.value.length > 4000) userInput.value = userInput.value.slice(0,4000);
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
});

async function sendMessage() {
    const msg = userInput.value.trim();
    if (!msg) return;
    sendBtn.disabled = true;
    userInput.disabled = true;
    addMessageToUI(msg, 'user');
    userInput.value = '';
    charCountSpan.innerText = '0';
    welcomeScreen.style.display = 'none';
    typingIndicator.classList.add('active');
    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: msg, history: conversationHistory })
        });
        if (res.status === 429) { showToast("Rate limit exceeded", true); return; }
        const data = await res.json();
        if (data.error) addMessageToUI(`⚠️ Error: ${data.error}`, 'bot');
        else {
            addMessageToUI(data.reply, 'bot', data.provider);
            conversationHistory.push({ role: "user", content: msg });
            conversationHistory.push({ role: "assistant", content: data.reply });
            if (conversationHistory.length > 30) conversationHistory = conversationHistory.slice(-30);
            localStorage.setItem(`gaba_conv_${currentSessionId}`, JSON.stringify(conversationHistory));
            modelLabel.innerText = data.provider ? data.provider.toUpperCase() : 'AI';
        }
    } catch(err) { addMessageToUI("Network error", 'bot'); }
    finally {
        typingIndicator.classList.remove('active');
        sendBtn.disabled = false;
        userInput.disabled = false;
        userInput.focus();
        scrollChat();
    }
}

function addMessageToUI(text, sender, provider=null) {
    const msgRow = document.createElement('div');
    msgRow.className = `msg-row ${sender}`;
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerText = sender === 'user' ? '👤' : '⚡';
    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'msg-body';
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span>${new Date().toLocaleTimeString()}</span>`;
    if (provider && sender === 'bot') meta.innerHTML += `<span class="provider-badge">${provider}</span>`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatMessage(text);
    bodyDiv.appendChild(meta);
    bodyDiv.appendChild(bubble);
    msgRow.appendChild(avatar);
    msgRow.appendChild(bodyDiv);
    messagesDiv.appendChild(msgRow);
    scrollChat();
}

function formatMessage(t) {
    t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    t = t.replace(/\n/g, '<br>');
    return t;
}
function escapeHtml(s) { return s.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function scrollChat() { document.querySelector('.chat-area').scrollTop = document.querySelector('.chat-area').scrollHeight; }
function clearChat() { if(confirm('Clear chat?')) { conversationHistory = []; messagesDiv.innerHTML = ''; welcomeScreen.style.display = 'flex'; localStorage.removeItem(`gaba_conv_${currentSessionId}`); renderHistory(); } }
function newChat() { currentSessionId = Math.random().toString(36).substring(2); localStorage.setItem('sessionId', currentSessionId); conversationHistory = []; messagesDiv.innerHTML = ''; welcomeScreen.style.display = 'flex'; renderHistory(); showToast('New chat'); }
function renderHistory() {
    const keys = []; for(let i=0; i<localStorage.length; i++) { let k = localStorage.key(i); if(k && k.startsWith('gaba_conv_')) keys.push(k); }
    historyListDiv.innerHTML = keys.length ? '' : '<div class="history-item" style="cursor:default;">No chats</div>';
    keys.slice(-5).forEach(key => {
        let item = document.createElement('div'); item.className = 'history-item';
        item.innerText = `Chat ${key.slice(11,17)}`;
        item.onclick = () => { loadChat(key); };
        historyListDiv.appendChild(item);
    });
}
function loadChat(key) {
    let saved = localStorage.getItem(key);
    if(saved) {
        conversationHistory = JSON.parse(saved);
        messagesDiv.innerHTML = '';
        welcomeScreen.style.display = conversationHistory.length ? 'none' : 'flex';
        renderMessages();
        currentSessionId = key.replace('gaba_conv_','');
        localStorage.setItem('sessionId', currentSessionId);
        showToast('Loaded conversation');
    }
}
function renderMessages() { for(let turn of conversationHistory) { if(turn.role === 'user') addMessageToUI(turn.content, 'user'); else if(turn.role === 'assistant') addMessageToUI(turn.content, 'bot'); } }

// Voice input
let recognition = null;
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => { userInput.value = e.results[0][0].transcript; sendMessage(); };
    recognition.onerror = () => showToast("Voice not recognized", true);
}
function startVoiceInput() {
    if(recognition) recognition.start();
    else showToast("Voice not supported in this browser", true);
}

// Auth modal
function toggleAuthModal() { authModal.style.display = authModal.style.display === 'flex' ? 'none' : 'flex'; checkAuthStatus(); }
function closeAuthModal() { authModal.style.display = 'none'; }
async function checkAuthStatus() {
    const res = await fetch('/auth/me');
    const data = await res.json();
    if(data.logged_in) {
        userLoggedIn = true;
        userEmail = data.email || 'user';
        authStatus.innerText = `Logged in as ${userEmail}`;
        authFormDiv.style.display = 'none';
        authLoggedInDiv.style.display = 'block';
        userEmailSpan.innerText = userEmail;
    } else {
        userLoggedIn = false;
        authStatus.innerText = 'Not logged in';
        authFormDiv.style.display = 'block';
        authLoggedInDiv.style.display = 'none';
    }
}
document.getElementById('authLoginBtn').onclick = async () => {
    const email = document.getElementById('authEmail').value;
    const pwd = document.getElementById('authPassword').value;
    const res = await fetch('/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email, password:pwd}) });
    if(res.ok) { showToast('Logged in'); closeAuthModal(); checkAuthStatus(); }
    else showToast('Login failed', true);
};
document.getElementById('authSignupBtn').onclick = async () => {
    const email = document.getElementById('authEmail').value;
    const pwd = document.getElementById('authPassword').value;
    const res = await fetch('/auth/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email, password:pwd}) });
    if(res.ok) { showToast('Signup successful, please login'); }
    else showToast('Signup failed', true);
};
document.getElementById('authLogoutBtn').onclick = async () => {
    await fetch('/auth/logout', { method:'POST' });
    showToast('Logged out');
    checkAuthStatus();
};

// ADMIN PANEL (full with provider priority editor)
let adminLoggedIn = false;
async function checkAdmin() { let r = await fetch('/admin/check'); let d = await r.json(); adminLoggedIn = d.logged_in; }
async function toggleAdminPanel() {
    let panel = document.getElementById('adminPanel');
    if(panel.style.display === 'flex') panel.style.display = 'none';
    else { panel.style.display = 'flex'; await checkAdmin(); await loadAdminContent(); }
}
async function loadAdminContent() {
    let content = document.getElementById('adminContent');
    if(!adminLoggedIn) {
        content.innerHTML = `<input id="adminPwd" class="admin-input" placeholder="Admin password" type="password"><button class="admin-btn admin-btn-primary" id="adminLoginBtn">Login</button><div id="adminErr"></div>`;
        document.getElementById('adminLoginBtn').onclick = async () => {
            let pwd = document.getElementById('adminPwd').value;
            let r = await fetch('/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pwd}) });
            if(r.ok) { adminLoggedIn=true; loadAdminContent(); showToast('Admin logged in'); }
            else document.getElementById('adminErr').innerText='Wrong password';
        };
        return;
    }
    let keysRes = await fetch('/admin/api_keys');
    let keys = await keysRes.json();
    let statsRes = await fetch('/admin/stats');
    let stats = await statsRes.json();
    let orderRes = await fetch('/admin/provider_order');
    let providerOrder = await orderRes.json();
    content.innerHTML = `
        <div class="admin-section"><h4>📊 Stats</h4><div class="stat-row">Conversations: ${stats.total_conversations}</div><div class="stat-row">API keys: ${stats.active_api_keys}</div><div class="stat-row">Users: ${stats.total_users}</div></div>
        <div class="admin-section"><h4>🔑 API Keys</h4><ul id="keyListAdmin" class="key-list"></ul><input id="newProvider" class="admin-input" placeholder="Provider"><input id="newKey" class="admin-input" placeholder="API key"><button class="admin-btn admin-btn-primary" id="addKeyBtn">Add Key</button></div>
        <div class="admin-section"><h4>⚙️ Provider Priority</h4><ul id="priorityList" class="key-list" style="cursor:grab;"></ul><button class="admin-btn admin-btn-primary" id="savePriorityBtn">Save Order</button></div>
        <div class="admin-section"><h4>💾 Backup</h4><button class="admin-btn admin-btn-primary" id="backupBtn">Backup Now</button></div>
        <div class="admin-section"><button class="admin-btn admin-btn-ghost" id="adminLogoutBtn">Logout</button></div>
    `;
    // Populate keys
    let keyList = document.getElementById('keyListAdmin');
    keyList.innerHTML = '';
    keys.forEach(k => {
        let li = document.createElement('li'); li.className = 'key-item';
        li.innerHTML = `<span class="key-provider">${k.provider}</span> <span class="key-masked">${k.api_key_masked}</span> <button class="key-delete" data-id="${k.id}">🗑️</button>`;
        keyList.appendChild(li);
    });
    document.querySelectorAll('.key-delete').forEach(btn => btn.onclick = async () => { await fetch('/admin/api_keys', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:btn.getAttribute('data-id')}) }); loadAdminContent(); });
    document.getElementById('addKeyBtn').onclick = async () => {
        let provider = document.getElementById('newProvider').value.trim().toLowerCase();
        let key = document.getElementById('newKey').value.trim();
        if(!provider || !key) return showToast('Provider and key required', true);
        await fetch('/admin/api_keys', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider, api_key:key}) });
        loadAdminContent();
    };
    // Priority list (drag drop)
    let priorityUl = document.getElementById('priorityList');
    priorityUl.innerHTML = '';
    providerOrder.forEach((p, idx) => {
        let li = document.createElement('li'); li.className = 'key-item'; li.setAttribute('data-provider', p);
        li.innerHTML = `<span class="key-provider">${p}</span> <span style="margin-left:auto;">☰</span>`;
        li.draggable = true;
        li.ondragstart = (e) => { e.dataTransfer.setData('text/plain', idx); };
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => {
            e.preventDefault();
            let from = parseInt(e.dataTransfer.getData('text/plain'));
            let to = idx;
            if(from !== to) {
                let arr = providerOrder;
                let moved = arr.splice(from,1)[0];
                arr.splice(to,0,moved);
                providerOrder = arr;
                loadAdminContent(); // refresh list
            }
        };
        priorityUl.appendChild(li);
    });
    document.getElementById('savePriorityBtn').onclick = async () => {
        let items = document.querySelectorAll('#priorityList .key-item');
        let newOrder = Array.from(items).map(li => li.getAttribute('data-provider'));
        await fetch('/admin/provider_order', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({order:newOrder}) });
        showToast('Provider order saved');
    };
    document.getElementById('backupBtn').onclick = async () => { let r = await fetch('/admin/backup', {method:'POST'}); let d = await r.json(); showToast(d.output ? 'Backup done' : 'Backup error', !d.output); };
    document.getElementById('adminLogoutBtn').onclick = async () => { await fetch('/admin/logout', {method:'POST'}); adminLoggedIn=false; loadAdminContent(); showToast('Admin logged out'); };
}
document.body.addEventListener('dblclick', (e) => { if(e.clientX<250 && window.innerHeight-e.clientY<250) toggleAdminPanel(); });
document.getElementById('adminClose').onclick = () => document.getElementById('adminPanel').style.display='none';
function showToast(msg, isErr=false) { let t = document.createElement('div'); t.className=`toast ${isErr?'error':''}`; t.innerText=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3000); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function useSuggestion(txt) { userInput.value = txt; sendMessage(); }
renderHistory();
setInterval(() => checkAuthStatus(), 60000);