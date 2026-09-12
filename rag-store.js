/**
 * rag-store.js
 * Local persistence + retrieval for user-uploaded reference documents.
 *
 * Storage shape in chrome.storage.local:
 *   ragDocs: { [docId]: { id, name, addedAt, chunkCount } }
 *   ragChunks: { [docId]: [ { chunkId, text, embedding: number[] } ] }
 *
 * Requires an embeddings-capable local LLM server (LM Studio with an
 * embedding model loaded, e.g. nomic-embed-text or bge-small) reachable
 * at the same baseUrl used for chat completions.
 */

(function () {
  const CHUNK_SIZE = 800;
  const CHUNK_OVERLAP = 100;
  const TOP_K = 3;

  function chunkText(text) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      chunks.push(text.slice(start, end).trim());
      if (end === text.length) break;
      start = end - CHUNK_OVERLAP;
    }
    return chunks.filter((c) => c.length > 0);
  }

  async function embed(text, { baseUrl, embeddingModelId }) {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: embeddingModelId,
        input: text
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Embedding request failed: HTTP ${res.status} ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      throw new Error('Embedding response did not contain a vector.');
    }
    return vector;
  }

  function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function addDocument(name, text, embedOpts) {
    if (!text || !text.trim()) throw new Error('Document is empty.');

    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('No chunkable content found.');

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const embeddedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const vector = await embed(chunks[i], embedOpts);
      embeddedChunks.push({
        chunkId: `${docId}_c${i}`,
        text: chunks[i],
        embedding: vector
      });
    }

    const { ragDocs = {}, ragChunks = {} } = await storageGet(['ragDocs', 'ragChunks']);

    ragDocs[docId] = {
      id: docId,
      name,
      addedAt: Date.now(),
      chunkCount: embeddedChunks.length
    };
    ragChunks[docId] = embeddedChunks;

    await storageSet({ ragDocs, ragChunks });

    return { id: docId, chunkCount: embeddedChunks.length };
  }

  async function listDocuments() {
    const { ragDocs = {} } = await storageGet(['ragDocs']);
    return Object.values(ragDocs).sort((a, b) => b.addedAt - a.addedAt);
  }

  async function deleteDocument(docId) {
    const { ragDocs = {}, ragChunks = {} } = await storageGet(['ragDocs', 'ragChunks']);
    delete ragDocs[docId];
    delete ragChunks[docId];
    await storageSet({ ragDocs, ragChunks });
  }

  async function clearAll() {
    await storageSet({ ragDocs: {}, ragChunks: {} });
  }

  async function retrieveRelevantChunks(queryText, embedOpts) {
    const { ragChunks = {} } = await storageGet(['ragChunks']);
    const allChunks = Object.values(ragChunks).flat();
    if (allChunks.length === 0) return [];

    let queryVector;
    try {
      queryVector = await embed(queryText, embedOpts);
    } catch (e) {
      console.warn('[LLM Guard] Failed to embed query for RAG retrieval:', e.message);
      return [];
    }

    const scored = allChunks.map((chunk) => ({
      text: chunk.text,
      score: cosineSimilarity(queryVector, chunk.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);

    const MIN_SCORE = 0.5;
    return scored
      .filter((s) => s.score >= MIN_SCORE)
      .slice(0, TOP_K)
      .map((s) => s.text);
  }

  window.LLMGuardRAG = {
    addDocument,
    listDocuments,
    deleteDocument,
    clearAll,
    retrieveRelevantChunks
  };
})();