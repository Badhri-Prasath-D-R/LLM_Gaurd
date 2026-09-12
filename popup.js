const baseUrlEl = document.getElementById('baseUrl');
const modelIdEl = document.getElementById('modelId');
const testMsgEl = document.getElementById('testMsg');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');

const DEFAULTS = {
  baseUrl: 'http://localhost:1234',
  modelId: 'google/gemma-4-e4b'
};

// Load saved settings on popup open
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

  // Persist settings for next time
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
