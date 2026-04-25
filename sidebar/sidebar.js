// ─── PART 1 — Injection ───────────────────────────────────────────────────────

let _shadowRoot = null;
let _sbAudioInstance = null;
let _currentWordData = null;

async function injectSidebar() {
  if (document.getElementById('vs-sidebar-host')) return;

  const host = document.createElement('div');
  host.id = 'vs-sidebar-host';
  document.body.appendChild(host);

  // Use a local variable while building; _shadowRoot is set only after the
  // DOM is fully ready so showSidebar/populateSidebar guards stay reliable.
  const shadow = host.attachShadow({ mode: 'open' });

  const [htmlText, cssText] = await Promise.all([
    fetch(chrome.runtime.getURL('sidebar/sidebar.html')).then(r => r.text()),
    fetch(chrome.runtime.getURL('sidebar/sidebar.css')).then(r => r.text()),
  ]);

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const tmp = document.createElement('div');
  tmp.innerHTML = htmlText.trim();
  shadow.appendChild(tmp.firstElementChild);

  shadow.querySelector('.vs-sb-close').addEventListener('click', hideSidebar);
  shadow.querySelector('.vs-sb-save').addEventListener('click', _saveCurrentWord);

  _shadowRoot = shadow;
}

// ─── PART 2 — Show / hide ────────────────────────────────────────────────────

function showSidebar() {
  if (!_shadowRoot) return;
  _shadowRoot.querySelector('#vs-sidebar').classList.add('vs-sb-visible');
}

function hideSidebar() {
  if (!_shadowRoot) return;
  _shadowRoot.querySelector('#vs-sidebar').classList.remove('vs-sb-visible');
}

// ─── PART 3 — Populate ───────────────────────────────────────────────────────

function _sbSentenceToHtml(sentence) {
  return sentence
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function populateSidebar(word, lemma, level, context, definition) {
  if (!_shadowRoot) return;
  _currentWordData = { word, lemma, level, definition };

  _shadowRoot.querySelector('.vs-sb-word').textContent = word;
  _shadowRoot.querySelector('.vs-sb-level-badge').textContent = level || '';
  _shadowRoot.querySelector('.vs-sb-phonetic').textContent = definition.phonetic || '';

  const audioBtn = _shadowRoot.querySelector('.vs-sb-audio');
  if (definition.audio) {
    audioBtn.style.display = '';
    audioBtn.onclick = () => {
      if (_sbAudioInstance) _sbAudioInstance.pause();
      _sbAudioInstance = new Audio(definition.audio);
      _sbAudioInstance.play().catch(() => {});
    };
  } else {
    audioBtn.style.display = 'none';
  }

  const ctxEl = _shadowRoot.querySelector('.vs-sb-context');
  ctxEl.innerHTML = context?.sentence ? _sbSentenceToHtml(context.sentence) : '';

  const defList = _shadowRoot.querySelector('.vs-sb-definitions-list');
  defList.innerHTML = '';
  if (!definition.error && definition.definitions?.length) {
    for (const def of definition.definitions) {
      const item = document.createElement('div');
      item.className = 'vs-def-item';

      const posEl = document.createElement('span');
      posEl.className = 'vs-pos';
      posEl.textContent = def.partOfSpeech || '';

      const defTextEl = document.createElement('p');
      defTextEl.className = 'vs-def-text';
      defTextEl.textContent = def.definition || '';

      item.appendChild(posEl);
      item.appendChild(defTextEl);

      if (def.example) {
        const exEl = document.createElement('p');
        exEl.className = 'vs-def-example';
        exEl.textContent = `“${def.example}”`;
        item.appendChild(exEl);
      }

      defList.appendChild(item);
    }
  } else if (definition.error) {
    defList.textContent = 'Definition not found.';
  }

  const synEl = _shadowRoot.querySelector('.vs-sb-synonyms');
  synEl.textContent = definition.synonyms?.length
    ? definition.synonyms.slice(0, 8).join(', ')
    : '—';

  const enc = encodeURIComponent(lemma || word);
  _shadowRoot.querySelector('.vs-sb-cambridge').href =
    `https://dictionary.cambridge.org/dictionary/english/${enc}`;
  _shadowRoot.querySelector('.vs-sb-merriam').href =
    `https://www.merriam-webster.com/dictionary/${enc}`;

  _shadowRoot.querySelector('.vs-sb-saved-msg').hidden = true;
}

// ─── Save word ────────────────────────────────────────────────────────────────

async function _saveCurrentWord() {
  if (!_currentWordData || !_shadowRoot) return;
  const msg = _shadowRoot.querySelector('.vs-sb-saved-msg');
  try {
    const { savedWords = [] } = await chrome.storage.local.get({ savedWords: [] });
    savedWords.push(_currentWordData);
    if (savedWords.length > 100) savedWords.splice(0, savedWords.length - 100);
    await chrome.storage.local.set({ savedWords });
    msg.textContent = 'Saved!';
  } catch {
    msg.textContent = 'Could not save — storage full?';
  }
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 2000);
}
