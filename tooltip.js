// ─── PART 1 — Tooltip element ────────────────────────────────────────────────

function createTooltip() {
  if (document.getElementById('vs-tooltip')) return;
  const el = document.createElement('div');
  el.id = 'vs-tooltip';
  el.innerHTML =
    '<div class="vs-source-label"></div>' +
    '<div class="vs-context"></div>' +
    '<div class="vs-word-header">' +
      '<span class="vs-word"></span>' +
      '<span class="vs-level"></span>' +
      '<span class="vs-phonetic"></span>' +
      '<button class="vs-audio" aria-label="Play pronunciation">&#128266;</button>' +
    '</div>' +
    '<div class="vs-definition"></div>' +
    '<div class="vs-example"></div>' +
    '<div class="vs-synonyms"></div>' +
    '<div class="vs-links"></div>' +
    '<button class="vs-full-def">Full definition &#x2192;</button>';
  document.body.appendChild(el);
}

// ─── PART 2 — Styles ─────────────────────────────────────────────────────────

function injectTooltipStyles() {
  if (document.getElementById('vs-tooltip-styles')) return;
  const style = document.createElement('style');
  style.id = 'vs-tooltip-styles';
  style.textContent = [
    '#vs-tooltip {',
    '  position: fixed;',
    '  z-index: 999999;',
    '  max-width: 320px;',
    '  background: white;',
    '  border-radius: 12px;',
    '  box-shadow: 0 4px 24px rgba(0,0,0,0.15);',
    '  padding: 16px;',
    '  font-family: system-ui, sans-serif;',
    '  font-size: 14px;',
    '  line-height: 1.5;',
    '  color: #1a1a1a;',
    '  border-top: 4px solid #0D9488;',
    '  display: none;',
    '}',
    '#vs-tooltip .vs-source-label {',
    '  font-size: 11px;',
    '  color: #888;',
    '  margin-bottom: 4px;',
    '  display: none;',
    '}',
    '#vs-tooltip .vs-context {',
    '  font-size: 13px;',
    '  color: #555;',
    '  font-style: italic;',
    '  margin-bottom: 10px;',
    '}',
    '#vs-tooltip .vs-word-header {',
    '  display: flex;',
    '  align-items: center;',
    '  flex-wrap: wrap;',
    '  gap: 6px;',
    '  margin-bottom: 8px;',
    '}',
    '#vs-tooltip .vs-word {',
    '  font-size: 16px;',
    '  font-weight: bold;',
    '}',
    '#vs-tooltip .vs-level {',
    '  background: #0D9488;',
    '  color: white;',
    '  border-radius: 4px;',
    '  padding: 2px 6px;',
    '  font-size: 11px;',
    '  font-weight: bold;',
    '}',
    '#vs-tooltip .vs-phonetic {',
    '  color: #666;',
    '  font-size: 13px;',
    '}',
    '#vs-tooltip .vs-audio {',
    '  background: none;',
    '  border: none;',
    '  cursor: pointer;',
    '  font-size: 16px;',
    '  padding: 0;',
    '  line-height: 1;',
    '}',
    '#vs-tooltip .vs-definition { margin-bottom: 6px; }',
    '#vs-tooltip .vs-example {',
    '  font-style: italic;',
    '  color: #444;',
    '  font-size: 13px;',
    '  margin-bottom: 8px;',
    '}',
    '#vs-tooltip .vs-synonyms {',
    '  color: #555;',
    '  font-size: 13px;',
    '  margin-bottom: 8px;',
    '}',
    '#vs-tooltip .vs-links { display: flex; gap: 8px; font-size: 13px; }',
    '#vs-tooltip .vs-links a { color: #0D9488; text-decoration: none; }',
    '#vs-tooltip .vs-links a:hover { text-decoration: underline; }',
    '#vs-tooltip .vs-full-def {',
    '  margin-top: 10px;',
    '  width: 100%;',
    '  padding: 8px 0;',
    '  background: #0D9488;',
    '  color: white;',
    '  border: none;',
    '  border-radius: 6px;',
    '  font-size: 13px;',
    '  cursor: pointer;',
    '  font-family: inherit;',
    '}',
    '#vs-tooltip .vs-full-def:hover { background: #0f766e; }',
  ].join('\n');
  document.head.appendChild(style);
}

// ─── PART 3 — Show / hide ────────────────────────────────────────────────────

let _audioInstance = null;
let _requestToken = 0; // incremented on each click; callbacks check against it to detect staleness

function _sentenceToHtml(sentence) {
  return sentence
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function _positionTooltip(tip, span) {
  const rect = (span instanceof Element) ? span.getBoundingClientRect() : span;
  const GAP = 8;
  const tipH = tip.offsetHeight;
  const tipW = tip.offsetWidth;

  let top = rect.top - tipH - GAP >= 0
    ? rect.top - tipH - GAP
    : rect.bottom + GAP;

  // Clamp vertical so the tooltip never overflows top or bottom of viewport.
  const maxTop = window.innerHeight - tipH - GAP;
  if (top > maxTop) top = maxTop;
  if (top < GAP) top = GAP;

  let left = rect.left;
  const maxLeft = window.innerWidth - tipW - GAP;
  if (left > maxLeft) left = maxLeft;
  if (left < GAP) left = GAP;

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function showTooltip(span, data, source = 'cefr') {
  const tip = document.getElementById('vs-tooltip');
  if (!tip) return;

  const isManual = source === 'manual';
  const definition = data.definition;
  const word = isManual
    ? data.word
    : (span.dataset.lemma || span.dataset.word || span.textContent.trim());

  const sourceLabelEl = tip.querySelector('.vs-source-label');
  if (sourceLabelEl) {
    sourceLabelEl.textContent = isManual ? 'Manual lookup' : '';
    sourceLabelEl.style.display = isManual ? '' : 'none';
  }

  const contextEl = tip.querySelector('.vs-context');
  if (isManual) {
    contextEl.innerHTML = '';
    contextEl.style.display = 'none';
  } else {
    contextEl.innerHTML = _sentenceToHtml(data.context.sentence);
    contextEl.style.display = '';
  }

  tip.querySelector('.vs-word').textContent = word;

  const levelEl = tip.querySelector('.vs-level');
  if (isManual) {
    levelEl.textContent = '';
    levelEl.style.display = 'none';
  } else {
    levelEl.textContent = span.dataset.level || '';
    levelEl.style.display = '';
  }

  const phoneticEl = tip.querySelector('.vs-phonetic');
  const audioBtn   = tip.querySelector('.vs-audio');
  const defEl      = tip.querySelector('.vs-definition');
  const exEl       = tip.querySelector('.vs-example');
  const synEl      = tip.querySelector('.vs-synonyms');
  const linksEl    = tip.querySelector('.vs-links');

  if (definition.error) {
    phoneticEl.textContent = '';
    audioBtn.style.display = 'none';
    defEl.textContent = 'Definition not found — try Cambridge Dictionary';
    exEl.style.display = 'none';
    synEl.style.display = 'none';
  } else {
    phoneticEl.textContent = definition.phonetic || '';

    if (definition.audio) {
      audioBtn.style.display = '';
      audioBtn.onclick = () => {
        if (_audioInstance) _audioInstance.pause();
        _audioInstance = new Audio(definition.audio);
        _audioInstance.play().catch(() => { audioBtn.style.display = 'none'; });
      };
    } else {
      audioBtn.style.display = 'none';
    }

    const firstDef = definition.definitions?.[0];
    if (firstDef) {
      defEl.textContent = `${firstDef.partOfSpeech} · ${firstDef.definition}`;
      if (firstDef.example) {
        exEl.textContent = firstDef.example;
        exEl.style.display = '';
      } else {
        exEl.style.display = 'none';
      }
    } else {
      defEl.textContent = '';
      exEl.style.display = 'none';
    }

    if (definition.synonyms?.length) {
      synEl.textContent = 'Synonyms: ' + definition.synonyms.join(', ');
      synEl.style.display = '';
    } else {
      synEl.style.display = 'none';
    }
  }

  const enc = encodeURIComponent(word);
  linksEl.innerHTML =
    `<a href="https://dictionary.cambridge.org/dictionary/english/${enc}" target="_blank" rel="noopener">Cambridge</a>` +
    ' | ' +
    `<a href="https://www.merriam-webster.com/dictionary/${enc}" target="_blank" rel="noopener">Merriam-Webster</a>`;

  const fullDefBtn = tip.querySelector('.vs-full-def');
  fullDefBtn.style.display = '';
  fullDefBtn.onclick = () => {
    hideTooltip();
    if (isManual) {
      populateSidebar(word, word, '', { sentence: '' }, definition);
    } else {
      populateSidebar(word, span.dataset.lemma || word, span.dataset.level || '', data.context, definition);
    }
    showSidebar();
  };

  tip.style.display = 'block';
  _positionTooltip(tip, span);
}

function _showLoading(span) {
  const tip = document.getElementById('vs-tooltip');
  if (!tip) return;
  const sourceLabelEl = tip.querySelector('.vs-source-label');
  if (sourceLabelEl) { sourceLabelEl.textContent = ''; sourceLabelEl.style.display = 'none'; }
  tip.querySelector('.vs-context').textContent = 'Loading…';
  tip.querySelector('.vs-context').style.display = '';
  tip.querySelector('.vs-word').textContent = span.dataset.lemma || span.textContent.trim();
  const levelEl = tip.querySelector('.vs-level');
  levelEl.textContent = span.dataset.level || '';
  levelEl.style.display = '';
  tip.querySelector('.vs-phonetic').textContent = '';
  tip.querySelector('.vs-audio').style.display = 'none';
  tip.querySelector('.vs-definition').textContent = '';
  tip.querySelector('.vs-example').style.display = 'none';
  tip.querySelector('.vs-synonyms').style.display = 'none';
  tip.querySelector('.vs-links').innerHTML = '';
  tip.querySelector('.vs-full-def').style.display = 'none';
  tip.style.display = 'block';
  _positionTooltip(tip, span);
}

function hideTooltip() {
  const tip = document.getElementById('vs-tooltip');
  if (tip) tip.style.display = 'none';
}

// ─── PART 3b — Manual lookup button ─────────────────────────────────────────

function _getLemmaForLookup(word) {
  if (typeof nlp !== 'function') return word;
  const doc = nlp(word);
  const infinitive = doc.verbs().toInfinitive().out('text');
  if (infinitive) return infinitive;
  const singular = doc.nouns().toSingular().out('text');
  if (singular) return singular;
  return word;
}

function _showLoadingAt(word, rect) {
  const tip = document.getElementById('vs-tooltip');
  if (!tip) return;
  const sourceLabelEl = tip.querySelector('.vs-source-label');
  if (sourceLabelEl) { sourceLabelEl.textContent = 'Manual lookup'; sourceLabelEl.style.display = ''; }
  const contextEl = tip.querySelector('.vs-context');
  contextEl.innerHTML = '';
  contextEl.style.display = 'none';
  tip.querySelector('.vs-word').textContent = word;
  const levelEl = tip.querySelector('.vs-level');
  levelEl.textContent = '';
  levelEl.style.display = 'none';
  tip.querySelector('.vs-phonetic').textContent = '';
  tip.querySelector('.vs-audio').style.display = 'none';
  tip.querySelector('.vs-definition').textContent = 'Loading…';
  tip.querySelector('.vs-example').style.display = 'none';
  tip.querySelector('.vs-synonyms').style.display = 'none';
  tip.querySelector('.vs-links').innerHTML = '';
  tip.querySelector('.vs-full-def').style.display = 'none';
  tip.style.display = 'block';
  _positionTooltip(tip, rect);
}

function removeLookupButton() {
  const btn = document.getElementById('vs-lookup-btn');
  if (btn) btn.remove();
}

function showLookupButton(selectedText, rect) {
  removeLookupButton();
  injectTooltipStyles();
  createTooltip();

  const btn = document.createElement('div');
  btn.id = 'vs-lookup-btn';
  btn.textContent = `Look up: ${selectedText}`;
  Object.assign(btn.style, {
    position: 'fixed',
    zIndex: '999997',
    background: '#0D9488',
    color: 'white',
    borderRadius: '20px',
    padding: '6px 12px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    opacity: '0',
    transition: 'opacity 150ms',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    border: 'none',
  });

  document.body.appendChild(btn);

  const btnW = btn.offsetWidth;
  const centerX = rect.left + rect.width / 2;
  let left = centerX - btnW / 2;
  const top = rect.top >= 60 ? rect.top - 40 : rect.bottom + 10;
  left = Math.max(4, Math.min(window.innerWidth - btnW - 4, left));

  btn.style.top = `${Math.round(top)}px`;
  btn.style.left = `${Math.round(left)}px`;

  requestAnimationFrame(() => { btn.style.opacity = '1'; });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeLookupButton();
    window.getSelection().removeAllRanges();

    // Multi-word phrases: skip lemmatization to avoid silently falling back to
    // a single-word definition (e.g. "climate change" → "change").
    const lemma = selectedText.includes(' ') ? selectedText : _getLemmaForLookup(selectedText);
    _showLoadingAt(selectedText, rect);

    const token = ++_requestToken;
    chrome.runtime.sendMessage(
      { action: 'fetchDefinition', word: selectedText, lemma },
      definition => {
        if (chrome.runtime.lastError || !definition) {
          definition = { error: true, word: selectedText };
        }
        if (token !== _requestToken) return;
        showTooltip(rect, { word: selectedText, definition }, 'manual');
      }
    );
  });
}

// ─── PART 4 — Event listeners ─────────────────────────────────────────────────

let _initialized = false;

function init() {
  if (_initialized) return;
  _initialized = true;

  injectTooltipStyles();
  createTooltip();
  injectSidebar().catch(err => console.error('[VocaSpot] sidebar injection failed:', err));

  document.addEventListener('click', e => {
    const clickedHighlight = e.target.closest('.vs-highlight');
    const clickedTooltip   = e.target.closest('#vs-tooltip');
    const clickedSidebar   = e.target.closest('#vs-sidebar-host');

    if (clickedHighlight) {
      e.stopPropagation();
      _showLoading(clickedHighlight);
      const context = extractContext(clickedHighlight);
      const token = ++_requestToken;
      chrome.runtime.sendMessage(
        { action: 'fetchDefinition', payload: { word: clickedHighlight.dataset.lemma } },
        definition => {
          // Service worker may be terminated mid-fetch (MV3); definition
          // arrives as undefined — treat it as a lookup failure.
          if (chrome.runtime.lastError || !definition) {
            definition = { error: true, word: clickedHighlight.dataset.lemma };
          }
          if (token !== _requestToken) return;
          showTooltip(clickedHighlight, { context, definition });
        }
      );
      return;
    }

    if (!clickedTooltip && !clickedSidebar) {
      hideTooltip();
      // Do NOT hide sidebar here — sidebar has its own close button and manages its own dismissal
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      removeLookupButton();
      if (isSidebarVisible()) {
        hideSidebar();  // Escape closes sidebar first
      } else {
        hideTooltip();  // then tooltip if sidebar already closed
      }
    }
  });
}
