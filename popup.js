const baseUrlEl = document.getElementById('baseUrl');
const modelIdEl = document.getElementById('modelId');
const testMsgEl = document.getElementById('testMsg');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');

const DEFAULTS = {
  baseUrl: 'http://localhost:1234',
  modelId: 'google/gemma-4-e4b'
};

chrome.storage.local.get(['baseUrl', 'modelId'], (data) => {
  baseUrlEl.value = data.baseUrl || DEFAULTS.baseUrl;
  modelIdEl.value = data.modelId || DEFAULTS.modelId;
});

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function testConnection() {
  const baseUrl = baseUrlEl.value.trim().replace(/\/+$/, '');
  const modelId = modelIdEl.value.trim();
  const message = testMsgEl.value.trim();

  if (!baseUrl || !modelId || !message) {
    setStatus('Fill in base URL, model ID, and a test message.', 'err');
    return;
  }

  chrome.storage.local.set({ baseUrl, modelId });

  testBtn.disabled = true;
  setStatus('Contacting LM Studio at ' + baseUrl + ' ...', 'pending');

  const endpoint = `${baseUrl}/v1/chat/completions`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: message }],
        temperature: 0.2,
        max_tokens: 100
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      setStatus(`HTTP ${res.status}\n${errText.slice(0, 300)}`, 'err');
      return;
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? '(no content in response)';
    setStatus(`Connected ✔\n\nModel replied:\n${reply}`, 'ok');
  } catch (err) {
    let hint = '';
    if (err.name === 'AbortError') {
      hint = 'Request timed out. Is the model loaded and the server running?';
    } else if (err.message.includes('Failed to fetch')) {
      hint = 'Could not reach the server. Check: (1) LM Studio local server is started, (2) the base URL/port match, (3) CORS is not blocking the request.';
    }
    setStatus(`Connection failed: ${err.message}\n${hint}`, 'err');
  } finally {
    testBtn.disabled = false;
  }
}

testBtn.addEventListener('click', testConnection);

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---------- Knowledge Base ----------
const embeddingModelIdEl = document.getElementById('embeddingModelId');
const ragEnabledEl = document.getElementById('ragEnabled');
const fileInputEl = document.getElementById('fileInput');
const pasteTextEl = document.getElementById('pasteText');
const pasteNameEl = document.getElementById('pasteName');
const addTextBtn = document.getElementById('addTextBtn');
const kbStatusEl = document.getElementById('kbStatus');
const docListEl = document.getElementById('docList');

chrome.storage.local.get(['embeddingModelId', 'ragEnabled'], (data) => {
  embeddingModelIdEl.value = data.embeddingModelId || '';
  ragEnabledEl.checked = Boolean(data.ragEnabled);
});

embeddingModelIdEl.addEventListener('change', () => {
  chrome.storage.local.set({ embeddingModelId: embeddingModelIdEl.value.trim() });
});
ragEnabledEl.addEventListener('change', () => {
  chrome.storage.local.set({ ragEnabled: ragEnabledEl.checked });
});

function setKbStatus(text, cls) {
  kbStatusEl.style.display = 'block';
  kbStatusEl.textContent = text;
  kbStatusEl.className = cls;
}

function getEmbedOpts() {
  const baseUrl = baseUrlEl.value.trim().replace(/\/+$/, '');
  const embeddingModelId = embeddingModelIdEl.value.trim();
  return { baseUrl, embeddingModelId };
}

async function refreshDocList() {
  const docs = await window.LLMGuardRAG.listDocuments();
  if (docs.length === 0) {
    docListEl.innerHTML = '<div class="empty-note">No documents indexed yet.</div>';
    return;
  }
  docListEl.innerHTML = docs
    .map(
      (d) => `
      <div class="doc-item" data-id="${d.id}">
        <div style="overflow:hidden;">
          <div class="doc-name">${escapeHtml(d.name)}</div>
          <div class="doc-meta">${d.chunkCount} chunk${d.chunkCount === 1 ? '' : 's'} · ${new Date(d.addedAt).toLocaleDateString()}</div>
        </div>
        <button class="delete-btn" data-id="${d.id}">Delete</button>
      </div>`
    )
    .join('');

  docListEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '...';
      await window.LLMGuardRAG.deleteDocument(btn.dataset.id);
      refreshDocList();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function addDocumentFromText(name, text) {
  const { baseUrl, embeddingModelId } = getEmbedOpts();
  if (!baseUrl) {
    setKbStatus('Set a Base URL in the Connection tab first.', 'err');
    return;
  }
  if (!embeddingModelId) {
    setKbStatus('Enter the embedding model ID above (must be loaded in LM Studio).', 'err');
    return;
  }
  if (!text || !text.trim()) {
    setKbStatus('Nothing to add — text is empty.', 'err');
    return;
  }

  addTextBtn.disabled = true;
  setKbStatus(`Embedding "${name}"... this may take a moment for larger documents.`, 'pending');

  try {
    const result = await window.LLMGuardRAG.addDocument(name, text, { baseUrl, embeddingModelId });
    setKbStatus(`Added "${name}" (${result.chunkCount} chunks).`, 'ok');
    await refreshDocList();
  } catch (e) {
    setKbStatus(`Failed to add document: ${e.message}`, 'err');
  } finally {
    addTextBtn.disabled = false;
  }
}

addTextBtn.addEventListener('click', async () => {
  const file = fileInputEl.files[0];
  if (file) {
    const text = await file.text();
    await addDocumentFromText(file.name, text);
    fileInputEl.value = '';
    return;
  }

  const text = pasteTextEl.value;
  const name = pasteNameEl.value.trim() || `Pasted text ${new Date().toLocaleString()}`;
  if (text.trim()) {
    await addDocumentFromText(name, text);
    pasteTextEl.value = '';
    pasteNameEl.value = '';
    return;
  }

  setKbStatus('Choose a file or paste some text first.', 'err');
});

refreshDocList();