const DEBUG = false;

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const EXCLUDE_TAGS = new Set(['nav', 'header', 'footer', 'aside']);
const EXCLUDE_ROLES = new Set(['navigation', 'banner', 'complementary', 'contentinfo']);
const EXCLUDE_PATTERN = /nav|menu|header|footer|sidebar|\bad\b|banner|comment|related|recommend|share|social|cookie|popup|modal|newsletter|subscribe/i;

function isExcluded(el) {
  if (EXCLUDE_TAGS.has(el.tagName.toLowerCase())) return true;
  const role = el.getAttribute('role');
  if (role && EXCLUDE_ROLES.has(role)) return true;
  const id = el.id || '';
  const cls = el.getAttribute('class') || '';
  return EXCLUDE_PATTERN.test(id) || EXCLUDE_PATTERN.test(cls);
}

function hasExcludedAncestor(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (isExcluded(node)) return true;
    node = node.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Noise-element skipping
//
// NOTE: Step 4 of the spec requests a clone-then-remove approach, but cloned
// text nodes are detached from the live DOM — highlightWords() can't insert
// spans on the visible page from a clone. Instead we collect elements to skip
// into _scanSkip here, and filter them inside scanArticle's TreeWalker.
// Effect on the user is identical: noisy content is never scanned or
// highlighted, and the live DOM is never mutated by findArticleBody.
// ---------------------------------------------------------------------------

// Populated once per findArticleBody() call; read by scanArticle's acceptNode.
const _scanSkip = new Set();

const NOISE_TRIM_PATTERN = /author|byline|contributor|caption|figcaption|timestamp|\btag\b|topic|breadcrumb|share|related/i;

function populateScanSkip(articleNode) {
  for (const el of articleNode.querySelectorAll('*')) {
    const cls = el.getAttribute('class') || '';
    const id = el.id || '';
    if (NOISE_TRIM_PATTERN.test(cls) || NOISE_TRIM_PATTERN.test(id)) _scanSkip.add(el);
  }

  for (const el of articleNode.querySelectorAll('figure, aside')) {
    _scanSkip.add(el);
  }

  const firstP = articleNode.querySelector('p');
  if (firstP) {
    const wordCount = firstP.textContent.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 12) {
      _scanSkip.add(firstP);
      if (DEBUG) console.log(`[VocaSpot] populateScanSkip: skipping short first <p> (${wordCount} words)`);
    }
  }
}

/**
 * Returns the live DOM node most likely to contain the main article text,
 * or null if nothing qualifies. As a side-effect, populates _scanSkip with
 * noisy child elements that scanArticle should ignore.
 */
function findArticleBody() {
  _scanSkip.clear();

  // Step 1 — collect candidates, excluding known chrome/navigation regions
  const candidates = [...document.querySelectorAll('article, main, div, section')].filter(
    el => !isExcluded(el) && !hasExcludedAncestor(el)
  );

  // Step 2 — score each candidate
  let winner = null;
  let highestScore = 0;
  let winnerParagraphCount = 0;

  for (const el of candidates) {
    const qualifying = [...el.querySelectorAll('p')].filter(
      p => p.textContent.trim().split(/\s+/).filter(Boolean).length > 20
    );
    if (qualifying.length < 3) continue;
    const totalTextLength = qualifying.reduce((sum, p) => sum + p.textContent.length, 0);
    const score = qualifying.length * totalTextLength;
    if (score > highestScore) {
      highestScore = score;
      winner = el;
      winnerParagraphCount = qualifying.length;
    }
  }

  // Step 3 — threshold check
  if (!winner) {
    if (DEBUG) console.log('[VocaSpot] no article body found');
    return null;
  }

  if (DEBUG) console.log(
    '[VocaSpot] article detected:',
    winner.tagName,
    (winner.getAttribute('class') || '').slice(0, 50),
    'score:', highestScore,
    'paragraphs:', winnerParagraphCount
  );

  // Step 4 — mark noise child elements to skip
  populateScanSkip(winner);
  return winner;
}

// ---------------------------------------------------------------------------
// CEFR wordlist — fetched once, shared across calls
// ---------------------------------------------------------------------------

const SKIP_INLINE_TAGS = new Set(['script', 'style', 'noscript', 'code', 'pre']);
const WORD_RE = /\b[a-zA-Z]{4,}\b/g;

// Yield back to the event loop when we have held the thread longer than this.
const YIELD_AFTER_MS = 10;

let cefrWordlist = null;
// FIX 2: Re-throw after logging so cefrWordlistReady rejects on failure,
// preventing scanArticle from running with a null wordlist.
const cefrWordlistReady = fetch(chrome.runtime.getURL('data/cefr_wordlist.json'))
  .then(r => r.json())
  .then(data => { cefrWordlist = data; })
  .catch(err => {
    console.warn('[VocaSpot] Could not load word list (data/cefr_wordlist.json). ' +
      'Check the extension is installed correctly. Highlighting disabled.', err);
    throw err;
  });

// FIX 1: Guard against nlp being absent (lib/compromise.min.js not populated).
// Returns the base lemma via compromise when available, else returns lowercase.
function getLemma(word) {
  const lower = word.toLowerCase();
  if (typeof nlp !== 'function') return lower;
  const doc = nlp(lower);
  // Browser compromise API: verbs().toInfinitive() / nouns().toSingular()
  // return '' when the word doesn't match that POS — safe to use as falsy.
  const infinitive = doc.verbs().toInfinitive().out('text');
  if (infinitive) return infinitive;
  const singular = doc.nouns().toSingular().out('text');
  if (singular) return singular;
  return lower;
}

// Yields to the event loop via setTimeout so the browser can handle paint/input.
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Walks all text nodes inside articleNode, finds words present in the CEFR
 * wordlist, and returns one result per unique lemma (first occurrence wins).
 *
 * @param {Node} articleNode
 * @returns {Promise<Array<{word, lemma, cefrLevel, textNode, offset}>>}
 */
async function scanArticle(articleNode) {
  // FIX 2: If the wordlist fetch failed, cefrWordlistReady rejects here
  // and the caller receives a rejected promise instead of a silent crash.
  await cefrWordlistReady;

  const walker = document.createTreeWalker(
    articleNode,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const tag = node.parentElement?.tagName?.toLowerCase();
        if (SKIP_INLINE_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;

        // Walk up to articleNode checking for byline/author ancestors.
        // Stop at articleNode itself to avoid scanning the full document tree.
        let el = node.parentElement;
        while (el && el !== articleNode) {
          if (_scanSkip.has(el)) return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const results = [];
  const seenLemmas = new Set();
  let totalWords = 0;
  let properNounSkips = 0;
  let cefrMatches = 0;

  let lastYield = performance.now();

  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.nodeValue;
    WORD_RE.lastIndex = 0;
    let match;
    while ((match = WORD_RE.exec(text)) !== null) {
      totalWords++;
      const raw = match[0];

      // Use raw (original case) so compromise can use capitalisation as a
      // signal — "London" is detected as a place, "london" is not.
      if (typeof nlp === 'function') {
        const rawDoc = nlp(raw);
        if (rawDoc.has('#ProperNoun') || rawDoc.people().length > 0 || rawDoc.places().length > 0) {
          properNounSkips++;
          continue;
        }
      }

      // Strategy 2: mid-sentence capitalised word → likely proper noun.
      // A word is at the start of a sentence when offset is 0 (start of text
      // node / block element) or the preceding non-whitespace char is . ! ?
      if (raw[0] !== raw[0].toLowerCase()) {
        const wordOffset = match.index;
        if (wordOffset > 0) {
          const preceding = text.slice(0, wordOffset).trimEnd();
          const prevChar = preceding[preceding.length - 1];
          if (prevChar && !/[.!?]/.test(prevChar)) {
            properNounSkips++;
            continue;
          }
        }
      }

      const lemma = getLemma(raw);
      if (seenLemmas.has(lemma)) continue;
      // Check lemma first, then raw lowercase as fallback for unlemmable forms.
      const cefrLevel = cefrWordlist[lemma] ?? cefrWordlist[raw.toLowerCase()];
      if (!cefrLevel) continue;
      cefrMatches++;
      seenLemmas.add(lemma);
      results.push({
        word: raw.toLowerCase(),
        lemma,
        cefrLevel,
        textNode,
        offset: match.index,
      });
    }

    // Yield after each text node if we've used the thread for too long.
    if (performance.now() - lastYield > YIELD_AFTER_MS) {
      await yieldToMain();
      lastYield = performance.now();
    }
  }

  if (DEBUG) console.log(
    `[VocaSpot] scanArticle: ${totalWords} words scanned, ` +
    `${properNounSkips} proper nouns skipped, ${cefrMatches} matched CEFR list`
  );
  return results;
}

// ---------------------------------------------------------------------------
// Filter and prioritise words for the user's level
// ---------------------------------------------------------------------------

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const MAX_HIGHLIGHTS = 20;

const COMMON_WORDS_BLACKLIST = new Set([
  'found', 'known', 'united', 'remains',
  'growing', 'general', 'following',
  'received', 'taken', 'given', 'called',
  'second', 'later', 'early', 'once',
  'across', 'around', 'within', 'further',
  'already', 'always', 'never', 'often',
  'walker', 'royal', 'prior', 'medium',
  'current', 'recent', 'former', 'senior',
]);

// Returns a sort-priority for a word's part of speech (lower = higher priority).
// Nouns first, then verbs, then adjectives, then everything else.
// POS views (nouns/verbs/adjectives) return an empty view when the tag doesn't match.
function getPosRank(word) {
  if (typeof nlp !== 'function') return 3;
  const doc = nlp(word);
  if (doc.nouns().length > 0) return 0;
  if (doc.verbs().length > 0) return 1;
  if (doc.adjectives().length > 0) return 2;
  return 3;
}

/**
 * Returns words whose cefrLevel exactly matches targetLevel, capped at MAX_HIGHLIGHTS.
 * When the cap applies, nouns are kept first, then verbs, then adjectives, then others.
 *
 * @param {Array<{word, lemma, cefrLevel, textNode, offset}>} words
 * @param {string} targetLevel  e.g. "B2"
 * @returns {Array<{word, lemma, cefrLevel, textNode, offset}>}
 */
function filterByUserLevel(words, targetLevel) {
  if (!CEFR_ORDER.includes(targetLevel)) {
    console.warn(`[VocaSpot] Unknown targetLevel: "${targetLevel}"`);
    return [];
  }

  const candidates = words.filter(w =>
    w.cefrLevel === targetLevel && !COMMON_WORDS_BLACKLIST.has(w.lemma)
  );

  if (candidates.length <= MAX_HIGHLIGHTS) return candidates;

  // Precompute POS rank once per word so the sort comparator doesn't call nlp
  // O(n log n) times — each word is evaluated exactly once.
  const withRank = candidates.map(w => [getPosRank(w.lemma), w]);
  withRank.sort(([ra], [rb]) => ra - rb);
  return withRank.slice(0, MAX_HIGHLIGHTS).map(([, w]) => w);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function removeHighlights() {
  for (const span of [...document.querySelectorAll('.vs-highlight')]) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }
  hideTooltip();
  hideSidebar();
}

async function main() {
  try {
    const { targetLevel = 'B2', highlightStyle = 'underline-dashed' } =
      await chrome.storage.sync.get({ targetLevel: 'B2', highlightStyle: 'underline-dashed' });
    if (DEBUG) console.log(`[VocaSpot] Target level: ${targetLevel}`);

    const articleNode = findArticleBody();
    if (!articleNode) {
      if (DEBUG) console.log('[VocaSpot] no article body found');
      return;
    }

    let words;
    performance.mark('vs-scan-start');
    try {
      words = await scanArticle(articleNode);
    } catch (err) {
      console.warn('[VocaSpot] main: word scan could not complete:', err);
      return;
    }
    performance.mark('vs-scan-end');
    performance.measure('VocaSpot: scanArticle', 'vs-scan-start', 'vs-scan-end');

    const filtered = filterByUserLevel(words, targetLevel);
    if (DEBUG) console.log(
      `[VocaSpot] main: ${filtered.length} word(s) to highlight:`,
      filtered.map(w => `${w.word} [${w.lemma}] (${w.cefrLevel})`)
    );

    highlightWords(filtered, highlightStyle);
    init();

    // Watch for large DOM mutations that indicate a SPA navigated to a new article
    // (e.g. BBC, Guardian). Disconnect any previous observer first so we don't
    // accumulate listeners across re-scans.
    if (_spaObserver) _spaObserver.disconnect();
    const _debouncedRescan = debounce(async () => {
      for (const span of document.querySelectorAll('.vs-highlight')) {
        span.replaceWith(document.createTextNode(span.textContent));
      }
      hideTooltip();
      await main();
    }, 1500);

    _spaObserver = new MutationObserver((mutations) => {
      // Ignore mutations caused by our own highlight insertions or UI elements.
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList?.contains('vs-highlight')) return;
          if (typeof node.id === 'string' && node.id.startsWith('vs-')) return;
        }
      }
      // Only re-scan when a meaningful amount of new text was added.
      let newChars = 0;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          newChars += node.textContent?.length ?? 0;
        }
      }
      if (newChars <= 200) return;
      _debouncedRescan();
    });
    _spaObserver.observe(document.body, { childList: true, subtree: true });
  } catch (err) {
    console.warn('[VocaSpot] unexpected error in main — extension did not crash the page:', err);
  }
}

// Run after the page is idle so we never block initial render or user interaction.
// timeout: 2000 guarantees the callback fires within 2 s even if the page never
// goes fully idle (common on news sites with continuous ad/analytics scripts).
// The typeof guard is a safety net; requestIdleCallback is available in all
// Chromium builds, but an explicit fallback makes the intent clear.
const scheduleIdle = typeof requestIdleCallback === 'function'
  ? cb => requestIdleCallback(cb, { timeout: 2000 })
  : cb => setTimeout(cb, 0);

scheduleIdle(async () => {
  const { disabledSites = [] } = await chrome.storage.sync.get({ disabledSites: [] });
  if (disabledSites.includes(window.location.hostname)) {
    if (DEBUG) console.log('[VocaSpot] disabled on this site, skipping');
    return;
  }
  main().catch(err => console.error('[VocaSpot] main error:', err));
});

let _rescanTimer = null;
let _spaObserver = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'settingsUpdated') return;
  clearTimeout(_rescanTimer);
  _rescanTimer = setTimeout(async () => {
    removeHighlights();
    const { disabledSites = [] } = await chrome.storage.sync.get({ disabledSites: [] });
    if (disabledSites.includes(window.location.hostname)) return;
    main().catch(err => console.error('[VocaSpot] re-scan error:', err));
  }, 150);
});
