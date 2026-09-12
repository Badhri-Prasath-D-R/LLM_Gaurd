/**
 * content.js
 * Injected into every page. Listens for paste events on editable elements,
 * scans pasted text with the Tier-1 regex engine, and if a leak is found,
 * blocks the paste and shows an inline warning banner near the field.
 */

(function () {
  // detectors.js is loaded before this script (see manifest.json),
  // so window.LLMGuardDetectors is available.
  const { scanText, redactText } = window.LLMGuardDetectors || {};
  if (!scanText) {
    console.warn('[LLM Guard] detectors.js did not load — paste scanning disabled.');
    return;
  }

  let activeBanner = null;

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

  function showBanner(targetEl, findings, pastedText) {
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
      insertText(targetEl, redactText(pastedText));
      removeBanner();
    });
    banner.querySelector('[data-action="proceed"]').addEventListener('click', () => {
      insertText(targetEl, pastedText);
      removeBanner();
    });
    banner.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      removeBanner();
    });

    // dismiss if user clicks elsewhere
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, { once: true, capture: true });
    }, 0);

    function onOutsideClick(e) {
      if (activeBanner && !activeBanner.contains(e.target)) {
        removeBanner();
      }
    }
  }

  function insertText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      el.value = before + text + after;
      const newPos = start + text.length;
      el.setSelectionRange(newPos, newPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      // Use execCommand for contenteditable — still broadly supported
      // and simplest for cross-site compatibility (Gmail, chat UIs, etc.)
      document.execCommand('insertText', false, text);
    }
  }

  document.addEventListener(
    'paste',
    (event) => {
      const target = event.target;
      if (!isEditableTarget(target)) return;

      const pastedText = getPastedText(event);
      if (!pastedText) return;

      const findings = scanText(pastedText);
      if (findings.length === 0) return; // silent — no leak, let paste proceed normally

      // block the native paste, show the warning banner instead
      event.preventDefault();
      event.stopPropagation();
      showBanner(target, findings, pastedText);
    },
    true // capture phase — catch it before site-specific handlers run
  );
})();
