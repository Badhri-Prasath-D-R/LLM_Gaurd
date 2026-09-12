const baseUrlEl = document.getElementById('baseUrl');
const modelIdEl = document.getElementById('modelId');
const savedEl = document.getElementById('saved');

chrome.storage.local.get(['baseUrl', 'modelId'], (data) => {
  baseUrlEl.value = data.baseUrl || 'http://localhost:1234';
  modelIdEl.value = data.modelId || 'google/gemma-4-e4b';
});

document.getElementById('saveBtn').addEventListener('click', () => {
  chrome.storage.local.set({
    baseUrl: baseUrlEl.value.trim().replace(/\/+$/, ''),
    modelId: modelIdEl.value.trim()
  }, () => {
    savedEl.textContent = 'Saved.';
    setTimeout(() => (savedEl.textContent = ''), 1500);
  });
});
