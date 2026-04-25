// ─── PART 1 — Tooltip element ────────────────────────────────────────────────

function createTooltip() {
  if (document.getElementById('vs-tooltip')) return;
  const el = document.createElement('div');
  el.id = 'vs-tooltip';
  el.innerHTML =
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
  const rect = span.getBoundingClientRect();
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

function showTooltip(span, data) {
  const tip = document.getElementById('vs-tooltip');
  if (!tip) return;

  const { context, definition } = data;
  const word = span.dataset.lemma || span.dataset.word || span.textContent.trim();

  tip.querySelector('.vs-context').innerHTML = _sentenceToHtml(context.sentence);
  tip.querySelector('.vs-word').textContent = word;
  tip.querySelector('.vs-level').textContent = span.dataset.level || '';

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
    populateSidebar(word, span.dataset.lemma || word, span.dataset.level || '', context, definition);
    showSidebar();
  };

  tip.style.display = 'block';
  _positionTooltip(tip, span);
}

function _showLoading(span) {
  const tip = document.getElementById('vs-tooltip');
  if (!tip) return;
  tip.querySelector('.vs-context').textContent = 'Loading…';
  tip.querySelector('.vs-word').textContent = span.dataset.lemma || span.textContent.trim();
  tip.querySelector('.vs-level').textContent = span.dataset.level || '';
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

// ─── PART 4 — Event listeners ─────────────────────────────────────────────────

let _initialized = false;

function init() {
  if (_initialized) return;
  _initialized = true;

  injectTooltipStyles();
  createTooltip();
  injectSidebar().catch(err => console.error('[VocaSpot] sidebar injection failed:', err));

  document.addEventListener('click', e => {
    const span = e.target.closest('.vs-highlight');

    if (span) {
      e.stopPropagation();
      _showLoading(span);
      const context = extractContext(span);
      const token = ++_requestToken;
      chrome.runtime.sendMessage(
        { action: 'fetchDefinition', payload: { word: span.dataset.lemma } },
        definition => {
          // Service worker may be terminated mid-fetch (MV3); definition
          // arrives as undefined — treat it as a lookup failure.
          if (chrome.runtime.lastError || !definition) {
            definition = { error: true, word: span.dataset.lemma };
          }
          if (token !== _requestToken) return;
          showTooltip(span, { context, definition });
        }
      );
      return;
    }

    if (!e.target.closest('#vs-tooltip')) {
      hideTooltip();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideTooltip();
  });
}
