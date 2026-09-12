/**
 * content.js
 * Injected into every page. Listens for paste events on editable elements,
 * scans pasted text with the Tier-1 regex engine, and if a leak is found,
 * blocks the paste and shows an inline warning banner near the field.
 */

(function () {
  const { scanText, redactText } = window.LLMGuardDetectors || {};
  const { analyzeText, shouldRunTier2 } = window.LLMGuardAnalyzer || {};
  const { retrieveRelevantChunks } = window.LLMGuardRAG || {};
  if (!scanText) {
    console.warn('[LLM Guard] detectors.js did not load — paste scanning disabled.');
    return;
  }

  let activeBanner = null;
  let tier2Settings = { baseUrl: '', modelId: '', tier2Enabled: false, embeddingModelId: '', ragEnabled: false };

  chrome.storage.local.get(
    ['baseUrl', 'modelId', 'tier2Enabled', 'embeddingModelId', 'ragEnabled'],
    (data) => {
      tier2Settings = {
        baseUrl: data.baseUrl || '',
        modelId: data.modelId || '',
        tier2Enabled: Boolean(data.tier2Enabled),
        embeddingModelId: data.embeddingModelId || '',
        ragEnabled: Boolean(data.ragEnabled)
      };
    }
  );
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.baseUrl) tier2Settings.baseUrl = changes.baseUrl.newValue || '';
    if (changes.modelId) tier2Settings.modelId = changes.modelId.newValue || '';
    if (changes.embeddingModelId) tier2Settings.embeddingModelId = changes.embeddingModelId.newValue || '';
    if (changes.ragEnabled) tier2Settings.ragEnabled = Boolean(changes.ragEnabled.newValue);
    if (changes.tier2Enabled) tier2Settings.tier2Enabled = Boolean(changes.tier2Enabled.newValue);
  });

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function getPastedText(event) {
    const cd = event.clipboardData || window.clipboardData;
    if (!cd) return '';
    return cd.getData('text/plain') || '';
  }

  function removeBanner() {
    if (activeBanner) {
      activeBanner.remove();
      activeBanner = null;
    }
  }

  function showBanner(targetEl, findings, pastedText, savedRange) {
    removeBanner();

    const banner = document.createElement('div');
    banner.setAttribute('data-llm-guard', 'banner');
    banner.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      max-width: 380px;
      background: #2a1414;
      border: 1px solid #c0392b;
      color: #f5e6e6;
      font-family: -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 13px;
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
      line-height: 1.4;
    `;

    const rect = targetEl.getBoundingClientRect();
    banner.style.top = `${Math.max(8, rect.top - 10)}px`;
    banner.style.left = `${Math.min(window.innerWidth - 400, rect.left)}px`;

    const labels = [...new Set(findings.map((f) => f.label))];

    banner.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">⚠ Possible sensitive data detected</div>
      <div style="margin-bottom:8px;">
        ${labels.map((l) => `<div>• ${l}</div>`).join('')}
      </div>
      <div style="display:flex; gap:8px;">
        <button data-action="redact" style="flex:1; padding:6px; border:none; border-radius:5px; background:#4f8ef7; color:white; cursor:pointer; font-weight:600;">Paste Redacted</button>
        <button data-action="proceed" style="flex:1; padding:6px; border:none; border-radius:5px; background:#555; color:white; cursor:pointer;">Paste Anyway</button>
        <button data-action="cancel" style="flex:1; padding:6px; border:none; border-radius:5px; background:#333; color:#ccc; cursor:pointer;">Cancel</button>
      </div>
    `;

    document.body.appendChild(banner);
    activeBanner = banner;

    banner.querySelector('[data-action="redact"]').addEventListener('click', () => {
      insertText(targetEl, redactText(pastedText), savedRange);
      removeBanner();
    });
    banner.querySelector('[data-action="proceed"]').addEventListener('click', () => {
      insertText(targetEl, pastedText, savedRange);
      removeBanner();
    });
    banner.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      removeBanner();
    });

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, { once: true, capture: true });
    }, 0);

    function onOutsideClick(e) {
      if (activeBanner && !activeBanner.contains(e.target)) {
        removeBanner();
      }
    }
  }

  function showTier2Banner(targetEl, verdict) {
    removeBanner();

    const banner = document.createElement('div');
    banner.setAttribute('data-llm-guard', 'banner-tier2');
    banner.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      max-width: 380px;
      background: #2a2414;
      border: 1px solid #c0932b;
      color: #f5eee6;
      font-family: -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 13px;
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
      line-height: 1.4;
    `;

    const rect = targetEl.getBoundingClientRect();
    banner.style.top = `${Math.max(8, rect.top - 10)}px`;
    banner.style.left = `${Math.min(window.innerWidth - 400, rect.left)}px`;

    banner.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">⚠ Possible sensitive content (AI review)</div>
      <div style="margin-bottom:8px;">
        <div>Confidence: ${verdict.confidence}</div>
        <div>${verdict.reason}</div>
      </div>
      <div style="font-size:11px; color:#c9bfa0; margin-bottom:8px;">
        This text was already pasted — this is a follow-up check, not a block. Review and remove it manually if needed.
      </div>
      <button data-action="dismiss" style="width:100%; padding:6px; border:none; border-radius:5px; background:#555; color:white; cursor:pointer;">Dismiss</button>
    `;

    document.body.appendChild(banner);
    activeBanner = banner;

    banner.querySelector('[data-action="dismiss"]').addEventListener('click', removeBanner);

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, { once: true, capture: true });
    }, 0);

    function onOutsideClick(e) {
      if (activeBanner && !activeBanner.contains(e.target)) {
        removeBanner();
      }
    }
  }

  function insertText(el, text, savedRange) {
    el.focus();

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const start = savedRange ? savedRange.start : (el.selectionStart ?? el.value.length);
      const end = savedRange ? savedRange.end : (el.selectionEnd ?? el.value.length);
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      el.value = before + text + after;
      const newPos = start + text.length;
      el.setSelectionRange(newPos, newPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      if (savedRange && savedRange.range) {
        selection.addRange(savedRange.range);
      }
      document.execCommand('insertText', false, text);
    }
  }

  function captureSelection(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return {
        start: el.selectionStart ?? el.value.length,
        end: el.selectionEnd ?? el.value.length
      };
    }
    if (el.isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        return { range: selection.getRangeAt(0).cloneRange() };
      }
    }
    return null;
  }

  document.addEventListener(
    'paste',
    (event) => {
      const target = event.target;
      if (!isEditableTarget(target)) return;

      const pastedText = getPastedText(event);
      if (!pastedText) return;

      const findings = scanText(pastedText);

      if (findings.length > 0) {
        const savedRange = captureSelection(target);
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        showBanner(target, findings, pastedText, savedRange);
        return;
      }

      if (
        analyzeText &&
        shouldRunTier2 &&
        tier2Settings.tier2Enabled &&
        tier2Settings.baseUrl &&
        tier2Settings.modelId &&
        shouldRunTier2(pastedText, findings)
      ) {
        runTier2(target, pastedText);
      }
    },
    true
  );

  async function runTier2(target, pastedText) {
    let contextChunks = [];

    if (tier2Settings.ragEnabled && tier2Settings.embeddingModelId && retrieveRelevantChunks) {
      try {
        contextChunks = await retrieveRelevantChunks(pastedText, {
          baseUrl: tier2Settings.baseUrl,
          embeddingModelId: tier2Settings.embeddingModelId
        });
      } catch (e) {
        console.warn('[LLM Guard] RAG retrieval failed, proceeding without context:', e.message);
      }
    }

    const verdict = await analyzeText(pastedText, {
      baseUrl: tier2Settings.baseUrl,
      modelId: tier2Settings.modelId,
      contextChunks
    });

    if (verdict.leak) {
      showTier2Banner(target, verdict);
    }
  }
})();