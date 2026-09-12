const baseUrlEl = document.getElementById('baseUrl');
const modelIdEl = document.getElementById('modelId');
const tier2EnabledEl = document.getElementById('tier2Enabled');
const savedEl = document.getElementById('saved');

chrome.storage.local.get(['baseUrl', 'modelId', 'tier2Enabled'], (data) => {
  baseUrlEl.value = data.baseUrl || 'http://localhost:1234';
  modelIdEl.value = data.modelId || 'google/gemma-4-e4b';
  tier2EnabledEl.checked = Boolean(data.tier2Enabled);
});

document.getElementById('saveBtn').addEventListener('click', () => {
  chrome.storage.local.set({
    baseUrl: baseUrlEl.value.trim().replace(/\/+$/, ''),
    modelId: modelIdEl.value.trim(),
    tier2Enabled: tier2EnabledEl.checked
  }, () => {
    savedEl.textContent = 'Saved.';
    setTimeout(() => (savedEl.textContent = ''), 1500);
  });
});