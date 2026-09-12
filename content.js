/**
 * content.js
 * Injected into every page. Listens for paste events on editable elements.
 * Tier 1 (regex) runs synchronously and blocks the paste on a hit.
 * Tier 2 (local LLM) runs in the background only when Tier 1 finds nothing,
 * and shows a retroactive warning if it flags the text — it never blocks,
 * since the LLM call is too slow to hold up typing.
 */

(function () {
  // detectors.js and llm-analyzer.js are loaded before this script (see manifest.json)
  const { scanText, redactText } = window.LLMGuardDetectors || {};
  const { analyzeText, shouldRunTier2 } = window.LLMGuardAnalyzer || {};
  if (!scanText) {
    console.warn('[LLM Guard] detectors.js did not load — paste scanning disabled.');
    return;
  }

  let activeBanner = null;
  let tier2Settings = { baseUrl: '', modelId: '', tier2Enabled: false };

  // Load Tier 2 config once, and keep it updated if the user changes settings
  chrome.storage.local.get(['baseUrl', 'modelId', 'tier2Enabled'], (data) => {
    tier2Settings = {
      baseUrl: data.baseUrl || '',
      modelId: data.modelId || '',
      tier2Enabled: Boolean(data.tier2Enabled)
    };
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.baseUrl) tier2Settings.baseUrl = changes.baseUrl.newValue || '';
    if (changes.modelId) tier2Settings.modelId = changes.modelId.newValue || '';
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

  /**
   * Retroactive warning for Tier 2 (semantic) findings. The paste has
   * already gone through by the time we get a verdict, so this is
   * informational only — no redact/proceed choice, just a heads-up.
   */
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
        // Tier 1 hit — block immediately, this is a confirmed structural match
        const savedRange = captureSelection(target);
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        showBanner(target, findings, pastedText, savedRange);
        return;
      }

      // No Tier 1 hit — optionally run Tier 2 (semantic) in the background.
      // The paste is NOT blocked for this; if Tier 2 later flags it, we
      // show a retroactive warning instead.
      if (
        analyzeText &&
        shouldRunTier2 &&
        tier2Settings.tier2Enabled &&
        tier2Settings.baseUrl &&
        tier2Settings.modelId &&
        shouldRunTier2(pastedText, findings)
      ) {
        analyzeText(pastedText, {
          baseUrl: tier2Settings.baseUrl,
          modelId: tier2Settings.modelId,
          contextChunks: [] // RAG not implemented yet — always empty for now
        }).then((verdict) => {
          if (verdict.leak) {
            showTier2Banner(target, verdict);
          }
          // if verdict.leak is false (or there was an error), stay silent
        });
      }
    },
    true // capture phase — catch it before site-specific handlers run
  );
})();