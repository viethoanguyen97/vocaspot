// VocaSpot - Vocabulary spotter for English learners
// Copyright (C) 2026 Grapes Labs by Viet Hoa Nguyen
// Licensed under GPL v3 — see LICENSE for details

const definitionCache = new Map();
const FETCH_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1000;

function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchDefinitionData(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;

  let res = await fetchWithTimeout(url);
  if (!res.ok) {
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error('not_found');
  }

  const data = await res.json();
  const entry = data[0];

  const phonetic = entry.phonetic
    ?? entry.phonetics?.find(p => p.text)?.text
    ?? '';

  const audio = entry.phonetics?.find(p => p.audio)?.audio ?? '';

  const definitions = [];
  const synonyms = [];

  for (const meaning of entry.meanings ?? []) {
    for (const def of meaning.definitions ?? []) {
      if (definitions.length < 3) {
        definitions.push({
          partOfSpeech: meaning.partOfSpeech,
          definition: def.definition,
          example: def.example ?? null,
        });
      }
    }
    for (const syn of meaning.synonyms ?? []) {
      if (synonyms.length < 5) synonyms.push(syn);
    }
  }

  return { word: entry.word, phonetic, audio, definitions, synonyms };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'fetchDefinition') return false;

  const word = message.payload?.word;
  if (!word) {
    sendResponse({ error: true, word: '' });
    return false;
  }

  if (definitionCache.has(word)) {
    sendResponse(definitionCache.get(word));
    return false;
  }

  fetchDefinitionData(word)
    .then(result => {
      definitionCache.set(word, result);
      sendResponse(result);
    })
    .catch(() => {
      sendResponse({ error: true, word });
    });

  return true;
});
