/**
 * llm-analyzer.js
 * Tier 2 — semantic analysis via a local LLM (LM Studio / Ollama-style
 * OpenAI-compatible endpoint).
 *
 * Designed to be RAG-ready: analyzeText() accepts an optional array of
 * context chunks. Today that array is always empty (no RAG store yet),
 * but the call shape won't need to change when RAG is added — you'll
 * just start passing retrieved chunks in from a retriever module.
 *
 * This tier only runs on text that Tier 1 (regex) did NOT already flag,
 * since a Tier 1 hit is already a confirmed leak and doesn't need an
 * LLM opinion. See shouldRunTier2() below.
 */

(function () {
  const DEFAULT_SYSTEM_PROMPT = `You are a data-loss-prevention classifier running locally inside a browser extension.
You will be shown a piece of text that a user is about to paste into a website (which may be a public LLM chat, an email client, or any other page).
Decide whether the text contains sensitive, confidential, or proprietary information that should NOT be shared externally.

Consider things like: internal project codenames, unreleased product details, proprietary source code or algorithms, internal financial figures, customer PII (names + emails/phone/address together), confidential meeting notes, or anything explicitly marked internal/confidential.

Do NOT flag: general knowledge, public information, ordinary conversational text, generic code that is not clearly proprietary (e.g. a textbook algorithm), or already-redacted placeholders like [REDACTED_X].

Respond with STRICT JSON ONLY, no prose, no markdown fences, in this exact shape:
{"leak": true or false, "confidence": "low" | "medium" | "high", "reason": "one short sentence"}`;

  function buildUserPrompt(text, contextChunks) {
    let prompt = '';

    if (contextChunks && contextChunks.length > 0) {
      prompt += 'Reference material (company policy / sensitive-data examples provided by the user):\n';
      contextChunks.forEach((chunk, i) => {
        prompt += `[Reference ${i + 1}]\n${chunk}\n\n`;
      });
      prompt += '---\n\n';
    }

    prompt += `Text to evaluate:\n"""\n${text}\n"""`;
    return prompt;
  }

  async function analyzeText(text, opts) {
    const {
      baseUrl,
      modelId,
      contextChunks = [],
      timeoutMs = 12000
    } = opts || {};

    if (!baseUrl || !modelId) {
      return { leak: false, confidence: 'low', reason: 'Tier 2 not configured (missing baseUrl/modelId).', error: 'not_configured' };
    }

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const userPrompt = buildUserPrompt(text, contextChunks);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 200
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        return { leak: false, confidence: 'low', reason: 'LLM request failed.', error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
      }

      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content ?? '';
      return parseVerdict(raw);
    } catch (err) {
      clearTimeout(timeout);
      const errLabel = err.name === 'AbortError' ? 'timeout' : err.message;
      return { leak: false, confidence: 'low', reason: 'Could not reach local LLM.', error: errLabel };
    }
  }

  function parseVerdict(raw) {
    if (!raw) return { leak: false, confidence: 'low', reason: 'Empty response from model.', raw };

    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        leak: Boolean(parsed.leak),
        confidence: parsed.confidence || 'medium',
        reason: parsed.reason || '(no reason given)',
        raw
      };
    } catch (e) {
      return { leak: false, confidence: 'low', reason: 'Could not parse model response.', raw, error: 'parse_error' };
    }
  }

  function shouldRunTier2(text, tier1Findings) {
    if (tier1Findings && tier1Findings.length > 0) return false;
    if (!text || text.trim().length < 40) return false;
    return true;
  }

  window.LLMGuardAnalyzer = { analyzeText, shouldRunTier2, buildUserPrompt, parseVerdict };
})();