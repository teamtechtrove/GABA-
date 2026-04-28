// ========== GABA v3.0 Frontend ==========
let conversationHistory = [];
let currentSessionId = localStorage.getItem('sessionId') || Math.random().toString(36).substring(2);
localStorage.setItem('sessionId', currentSessionId);
let userLoggedIn = false;
let userEmail = '';
let stickToBottom = true;

// DOM elements
const chatArea = document.getElementById('chatArea');
const messagesDiv = document.getElementById('messages');
const welcomeScreen = document.getElementById('welcomeScreen');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const modelPill = document.getElementById('modelPill');
const modelLabel = document.getElementById('modelLabel');
const historyListDiv = document.getElementById('historyList');
const charCountSpan = document.getElementById('charCount');
const authModal = document.getElementById('authModal');
const authStatus = document.getElementById('authStatus');
const authFormDiv = document.getElementById('authForm');
const authLoggedInDiv = document.getElementById('authLoggedIn');
const userEmailSpan = document.getElementById('userEmail');
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const scrollBottomBtn = document.getElementById('scrollBottomBtn');

// Restore previous conversation
const saved = localStorage.getItem(`gaba_conv_${currentSessionId}`);
if (saved) {
    try {
        conversationHistory = JSON.parse(saved);
        if (conversationHistory.length) {
            welcomeScreen.classList.add('hidden');
            renderMessages();
        }
    } catch (e) {}
}

// ===== Input behavior =====
userInput.addEventListener('input', () => {
    charCountSpan.innerText = userInput.value.length;
    if (userInput.value.length > 4000) userInput.value = userInput.value.slice(0, 4000);
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
});

userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Track scroll position to decide auto-scroll & toggle the jump button
chatArea.addEventListener('scroll', () => {
    const distance = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    stickToBottom = distance < 80;
    scrollBottomBtn.classList.toggle('visible', distance > 200);
});

// ===== Send / receive =====
async function sendMessage() {
    const msg = userInput.value.trim();
    if (!msg) return;
    sendBtn.disabled = true;
    addMessageToUI(msg, 'user');
    conversationHistory.push({ role: 'user', content: msg });
    userInput.value = '';
    userInput.style.height = 'auto';
    charCountSpan.innerText = '0';
    welcomeScreen.classList.add('hidden');
    typingIndicator.classList.add('active');
    modelPill.classList.add('thinking');
    stickToBottom = true;
    scrollChat(true);
    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, history: conversationHistory.slice(0, -1) })
        });
        if (res.status === 429) {
            showToast('Slow down — too many messages', true);
            return;
        }
        const data = await res.json();
        if (data.error) {
            addMessageToUI(`⚠️ ${data.error}`, 'bot');
        } else {
            addMessageToUI(data.reply, 'bot', data.provider, true);
            conversationHistory.push({ role: 'assistant', content: data.reply });
            if (conversationHistory.length > 30) conversationHistory = conversationHistory.slice(-30);
            localStorage.setItem(`gaba_conv_${currentSessionId}`, JSON.stringify(conversationHistory));
            if (data.provider) modelLabel.innerText = data.provider.toUpperCase();
            renderHistory();
        }
    } catch (err) {
        addMessageToUI('Network error — please try again.', 'bot');
    } finally {
        typingIndicator.classList.remove('active');
        modelPill.classList.remove('thinking');
        sendBtn.disabled = false;
        userInput.focus();
    }
}

// ===== Render =====
function addMessageToUI(text, sender, provider = null, animateTyping = false) {
    const msgRow = document.createElement('div');
    msgRow.className = `msg-row ${sender}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerText = sender === 'user' ? 'U' : 'G';

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `<span>${time}</span>`;
    if (provider && sender === 'bot') meta.innerHTML += `<span class="provider-badge">${provider}</span>`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    bodyDiv.appendChild(meta);
    bodyDiv.appendChild(bubble);
    msgRow.appendChild(avatar);
    msgRow.appendChild(bodyDiv);
    messagesDiv.appendChild(msgRow);

    if (animateTyping && sender === 'bot') {
        typewriter(bubble, text);
    } else {
        bubble.innerHTML = formatMessage(text);
        wireCodeCopyButtons(bubble);
    }
    if (stickToBottom) scrollChat();
}

// Typewriter for bot replies — char-batched so it feels smooth, not laggy
function typewriter(el, text) {
    const total = text.length;
    // Adapt speed to length so long messages don't take forever
    const batch = Math.max(2, Math.floor(total / 200));
    let i = 0;
    function tick() {
        i = Math.min(total, i + batch);
        el.innerHTML = formatMessage(text.slice(0, i)) + (i < total ? '<span class="caret">▍</span>' : '');
        if (stickToBottom) scrollChat();
        if (i < total) {
            requestAnimationFrame(tick);
        } else {
            el.innerHTML = formatMessage(text);
            wireCodeCopyButtons(el);
        }
    }
    tick();
}

function wireCodeCopyButtons(scope) {
    scope.querySelectorAll('.code-block-wrapper').forEach(wrap => {
        const btn = wrap.querySelector('.code-copy-btn');
        if (!btn || btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.onclick = () => {
            const code = wrap.querySelector('code').innerText;
            navigator.clipboard.writeText(code).then(() => {
                btn.classList.add('copied');
                btn.innerText = 'Copied';
                setTimeout(() => { btn.classList.remove('copied'); btn.innerText = 'Copy'; }, 1500);
            });
        };
    });
}

// ===== Lightweight Markdown =====
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatMessage(t) {
    if (!t) return '';
    // Pull out code blocks first so their contents aren't re-formatted
    const blocks = [];
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
        const idx = blocks.length;
        blocks.push(`<div class="code-block-wrapper"><button class="code-copy-btn">Copy</button><pre><code class="language-${lang || 'text'}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
        return `\u0000BLOCK${idx}\u0000`;
    });

    t = escapeHtml(t);

    // Inline code
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Headings
    t = t.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    t = t.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold + italic
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // Links
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

    // Lists — group consecutive lines starting with - or 1. into ul/ol
    const lines = t.split('\n');
    const out = [];
    let listType = null;
    for (const line of lines) {
        const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
        const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
        if (ulMatch) {
            if (listType !== 'ul') { if (listType) out.push(`</${listType}>`); out.push('<ul>'); listType = 'ul'; }
            out.push(`<li>${ulMatch[1]}</li>`);
        } else if (olMatch) {
            if (listType !== 'ol') { if (listType) out.push(`</${listType}>`); out.push('<ol>'); listType = 'ol'; }
            out.push(`<li>${olMatch[1]}</li>`);
        } else {
            if (listType) { out.push(`</${listType}>`); listType = null; }
            out.push(line);
        }
    }
    if (listType) out.push(`</${listType}>`);
    t = out.join('\n');

    // Paragraphs / line breaks (don't break inside block elements)
    t = t.replace(/\n{2,}/g, '</p><p>');
    t = t.replace(/(?<!>)\n(?!<)/g, '<br>');
    t = `<p>${t}</p>`;
    t = t.replace(/<p>(\s*<(h[1-3]|ul|ol|div)[^>]*>)/g, '$1');
    t = t.replace(/(<\/(h[1-3]|ul|ol|div)>\s*)<\/p>/g, '$1');

    // Restore code blocks
    t = t.replace(/\u0000BLOCK(\d+)\u0000/g, (m, i) => blocks[parseInt(i)]);
    return t;
}

function scrollChat(force = false) {
    if (force || stickToBottom) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

function clearChat() {
    conversationHistory = [];
    messagesDiv.innerHTML = '';
    welcomeScreen.classList.remove('hidden');
    localStorage.removeItem(`gaba_conv_${currentSessionId}`);
    renderHistory();
    showToast('Chat cleared');
}

function newChat() {
    if (conversationHistory.length) {
        // Persist current chat is already saved; just rotate session
        currentSessionId = Math.random().toString(36).substring(2);
        localStorage.setItem('sessionId', currentSessionId);
    }
    conversationHistory = [];
    messagesDiv.innerHTML = '';
    welcomeScreen.classList.remove('hidden');
    renderHistory();
    closeSidebar();
    userInput.focus();
}

function renderHistory() {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('gaba_conv_')) continue;
        try {
            const conv = JSON.parse(localStorage.getItem(k));
            if (!conv.length) continue;
            const firstUser = conv.find(c => c.role === 'user');
            const title = firstUser ? firstUser.content.slice(0, 38) : 'Empty chat';
            items.push({ key: k, title, id: k.replace('gaba_conv_', '') });
        } catch (e) {}
    }
    historyListDiv.innerHTML = items.length
        ? ''
        : '<div class="history-item" style="cursor:default;opacity:0.6;">No recent chats</div>';
    items.slice(-8).reverse().forEach(it => {
        const div = document.createElement('div');
        div.className = 'history-item' + (it.id === currentSessionId ? ' active' : '');
        div.innerText = it.title + (it.title.length >= 38 ? '…' : '');
        div.onclick = () => loadChat(it.key);
        historyListDiv.appendChild(div);
    });
}

function loadChat(key) {
    const data = localStorage.getItem(key);
    if (!data) return;
    conversationHistory = JSON.parse(data);
    messagesDiv.innerHTML = '';
    welcomeScreen.classList.toggle('hidden', conversationHistory.length > 0);
    renderMessages();
    currentSessionId = key.replace('gaba_conv_', '');
    localStorage.setItem('sessionId', currentSessionId);
    renderHistory();
    closeSidebar();
}

function renderMessages() {
    for (const turn of conversationHistory) {
        if (turn.role === 'user') addMessageToUI(turn.content, 'user');
        else if (turn.role === 'assistant') addMessageToUI(turn.content, 'bot');
    }
}

// ===== Voice =====
let recognition = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
        userInput.value = e.results[0][0].transcript;
        userInput.dispatchEvent(new Event('input'));
        sendMessage();
    };
    recognition.onerror = () => showToast('Voice not recognized', true);
}
function startVoiceInput() {
    if (recognition) {
        showToast('Listening…');
        try { recognition.start(); } catch (e) {}
    } else {
        showToast('Voice not supported here', true);
    }
}

// ===== Auth modal =====
function toggleAuthModal() {
    const isOpen = authModal.classList.contains('open');
    if (isOpen) closeAuthModal();
    else { authModal.classList.add('open'); checkAuthStatus(); }
}
function closeAuthModal() { authModal.classList.remove('open'); }

async function checkAuthStatus() {
    try {
        const res = await fetch('/auth/me');
        const data = await res.json();
        if (data.logged_in) {
            userLoggedIn = true;
            userEmail = data.email || 'user';
            authStatus.innerText = `Signed in as ${userEmail}`;
            authFormDiv.style.display = 'none';
            authLoggedInDiv.style.display = 'block';
            userEmailSpan.innerText = userEmail;
        } else {
            userLoggedIn = false;
            authStatus.innerText = 'Not signed in';
            authFormDiv.style.display = 'block';
            authLoggedInDiv.style.display = 'none';
        }
    } catch (e) {
        authStatus.innerText = 'Connection issue';
    }
}

document.getElementById('authLoginBtn').onclick = async () => {
    const email = document.getElementById('authEmail').value.trim();
    const pwd = document.getElementById('authPassword').value;
    if (!email || !pwd) return showToast('Email and password required', true);
    const res = await fetch('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd })
    });
    if (res.ok) { showToast('Signed in'); closeAuthModal(); checkAuthStatus(); }
    else showToast('Sign-in failed', true);
};
document.getElementById('authSignupBtn').onclick = async () => {
    const email = document.getElementById('authEmail').value.trim();
    const pwd = document.getElementById('authPassword').value;
    if (!email || !pwd) return showToast('Email and password required', true);
    const res = await fetch('/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd })
    });
    if (res.ok) showToast('Account created — sign in now');
    else showToast('Sign-up failed', true);
};
document.getElementById('authLogoutBtn').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    showToast('Signed out');
    checkAuthStatus();
};

// ===== Admin panel =====
let adminLoggedIn = false;
async function checkAdmin() {
    const r = await fetch('/admin/check');
    const d = await r.json();
    adminLoggedIn = d.logged_in;
}
async function toggleAdminPanel() {
    const panel = document.getElementById('adminPanel');
    if (panel.classList.contains('open')) panel.classList.remove('open');
    else { panel.classList.add('open'); await checkAdmin(); await loadAdminContent(); }
}
async function loadAdminContent() {
    const content = document.getElementById('adminContent');
    if (!adminLoggedIn) {
        content.innerHTML = `<input id="adminPwd" class="admin-input" placeholder="Admin password" type="password"><button class="admin-btn admin-btn-primary" id="adminLoginBtn">Login</button><div id="adminErr" class="admin-error"></div>`;
        document.getElementById('adminLoginBtn').onclick = async () => {
            const pwd = document.getElementById('adminPwd').value;
            const r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
            if (r.ok) { adminLoggedIn = true; loadAdminContent(); showToast('Admin signed in'); }
            else document.getElementById('adminErr').innerText = 'Wrong password';
        };
        return;
    }
    const [keysRes, statsRes, orderRes] = await Promise.all([
        fetch('/admin/api_keys'), fetch('/admin/stats'), fetch('/admin/provider_order')
    ]);
    const keys = await keysRes.json();
    const stats = await statsRes.json();
    let providerOrder = await orderRes.json();
    content.innerHTML = `
        <div class="admin-section"><h4>Stats</h4><div class="stat-row"><span>Conversations</span><span class="stat-val">${stats.total_conversations}</span></div><div class="stat-row"><span>Active keys</span><span class="stat-val">${stats.active_api_keys}</span></div><div class="stat-row"><span>Users</span><span class="stat-val">${stats.total_users}</span></div></div>
        <div class="admin-section"><h4>API Keys</h4><ul id="keyListAdmin" class="key-list"></ul><input id="newProvider" class="admin-input" placeholder="Provider (groq, openai, ...)"><input id="newKey" class="admin-input" placeholder="API key"><button class="admin-btn admin-btn-primary" id="addKeyBtn">Add Key</button></div>
        <div class="admin-section"><h4>Provider Priority</h4><ul id="priorityList" class="key-list"></ul><button class="admin-btn admin-btn-primary" id="savePriorityBtn">Save Order</button></div>
        <div class="admin-section"><h4>Backup</h4><button class="admin-btn admin-btn-primary" id="backupBtn">Backup Now</button></div>
        <div class="admin-section"><button class="admin-btn admin-btn-ghost" id="adminLogoutBtn">Logout</button></div>
    `;
    const keyList = document.getElementById('keyListAdmin');
    keys.forEach(k => {
        const li = document.createElement('li');
        li.className = 'key-item';
        li.innerHTML = `<span class="key-active-dot ${k.is_active ? '' : 'key-inactive-dot'}"></span><div class="key-item-info"><div class="key-provider">${k.provider}</div><div class="key-masked">${k.api_key_masked}</div></div><button class="key-delete" data-id="${k.id}">✕</button>`;
        keyList.appendChild(li);
    });
    document.querySelectorAll('.key-delete').forEach(btn => btn.onclick = async () => {
        await fetch('/admin/api_keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.getAttribute('data-id') }) });
        loadAdminContent();
    });
    document.getElementById('addKeyBtn').onclick = async () => {
        const provider = document.getElementById('newProvider').value.trim().toLowerCase();
        const key = document.getElementById('newKey').value.trim();
        if (!provider || !key) return showToast('Provider and key required', true);
        await fetch('/admin/api_keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, api_key: key }) });
        loadAdminContent();
    };
    const priorityUl = document.getElementById('priorityList');
    providerOrder.forEach((p, idx) => {
        const li = document.createElement('li');
        li.className = 'key-item';
        li.setAttribute('data-provider', p);
        li.innerHTML = `<span class="key-provider">${p}</span><span style="margin-left:auto;color:var(--text-muted);">☰</span>`;
        li.draggable = true;
        li.ondragstart = (e) => e.dataTransfer.setData('text/plain', idx);
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer.getData('text/plain'));
            const to = idx;
            if (from !== to) {
                const moved = providerOrder.splice(from, 1)[0];
                providerOrder.splice(to, 0, moved);
                loadAdminContent();
            }
        };
        priorityUl.appendChild(li);
    });
    document.getElementById('savePriorityBtn').onclick = async () => {
        const items = document.querySelectorAll('#priorityList .key-item');
        const newOrder = Array.from(items).map(li => li.getAttribute('data-provider'));
        await fetch('/admin/provider_order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: newOrder }) });
        showToast('Provider order saved');
    };
    document.getElementById('backupBtn').onclick = async () => {
        const r = await fetch('/admin/backup', { method: 'POST' });
        const d = await r.json();
        showToast(d.output ? 'Backup done' : 'Backup error', !d.output);
    };
    document.getElementById('adminLogoutBtn').onclick = async () => {
        await fetch('/admin/logout', { method: 'POST' });
        adminLoggedIn = false;
        loadAdminContent();
        showToast('Admin signed out');
    };
}

// Hidden admin trigger: double-click bottom-left corner
document.body.addEventListener('dblclick', (e) => {
    if (e.clientX < 250 && window.innerHeight - e.clientY < 250) toggleAdminPanel();
});
document.getElementById('adminClose').onclick = () => document.getElementById('adminPanel').classList.remove('open');

// ===== Helpers =====
function showToast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = `toast ${isErr ? 'error' : ''}`;
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
}

function toggleSidebar() {
    sidebarEl.classList.toggle('open');
    sidebarBackdrop.classList.toggle('active', sidebarEl.classList.contains('open'));
}
function closeSidebar() {
    sidebarEl.classList.remove('open');
    sidebarBackdrop.classList.remove('active');
}

function useSuggestion(txt) {
    userInput.value = txt;
    userInput.dispatchEvent(new Event('input'));
    userInput.focus();
}

// Expose handlers used from inline onclicks
window.sendMessage = sendMessage;
window.clearChat = clearChat;
window.newChat = newChat;
window.toggleAuthModal = toggleAuthModal;
window.closeAuthModal = closeAuthModal;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.useSuggestion = useSuggestion;
window.startVoiceInput = startVoiceInput;
window.scrollChat = scrollChat;

// ESC closes modals/panels; click outside auth modal closes it
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (authModal.classList.contains('open')) closeAuthModal();
        if (document.getElementById('adminPanel').classList.contains('open')) document.getElementById('adminPanel').classList.remove('open');
        if (sidebarEl.classList.contains('open')) closeSidebar();
    }
});
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

renderHistory();
checkAuthStatus();
