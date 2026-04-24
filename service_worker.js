const definitionCache = new Map();

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

  fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    .then(res => {
      if (!res.ok) throw new Error('not_found');
      return res.json();
    })
    .then(data => {
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

      const result = { word: entry.word, phonetic, audio, definitions, synonyms };
      definitionCache.set(word, result);
      sendResponse(result);
    })
    .catch(() => {
      sendResponse({ error: true, word });
    });

  return true;
});
