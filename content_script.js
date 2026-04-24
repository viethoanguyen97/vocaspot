// Noise selectors that should never be treated as article body
const SKIP_TAGS = new Set(['nav', 'header', 'footer', 'aside']);
const SKIP_PATTERN = /menu|sidebar|\bad\b|banner|comment|footer|related/i;

function isNoisy(el) {
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
  const id = el.id || '';
  const cls = el.className || '';
  return SKIP_PATTERN.test(id) || SKIP_PATTERN.test(cls);
}

function hasNoisyAncestor(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (isNoisy(node)) return true;
    node = node.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Byline / author-area filtering
//
// NOTE: the spec requested a clone-then-strip approach, but cloned text nodes
// are detached from the live DOM — highlightWords() can't use them to insert
// spans on the visible page. Instead we collect elements to skip into
// _scanSkip here, and filter them inside scanArticle's TreeWalker acceptNode.
// Effect on the user is identical: byline content is never scanned or
// highlighted, and the live DOM is never mutated by findArticleBody.
// ---------------------------------------------------------------------------

// Populated once per findArticleBody() call; read by scanArticle's acceptNode.
const _scanSkip = new Set();

const BYLINE_PATTERN = /\b(author|byline|contributor|meta)\b/i;
const BYLINE_WORD_THRESHOLD = 15;

function isBylineElement(el) {
  if (el.getAttribute('rel') === 'author') return true;
  // Use getAttribute('class') rather than el.className — SVG elements return
  // an SVGAnimatedString object from .className, not a plain string.
  const cls = el.getAttribute('class') || '';
  const id  = el.id || '';
  return BYLINE_PATTERN.test(cls) || BYLINE_PATTERN.test(id);
}

function populateScanSkip(articleNode) {
  for (const el of articleNode.querySelectorAll('*')) {
    if (isBylineElement(el)) _scanSkip.add(el);
  }

  // First <p> with fewer than BYLINE_WORD_THRESHOLD words is almost always
  // a byline, dateline, or image caption rather than article body text.
  const firstP = articleNode.querySelector('p');
  if (firstP) {
    const wordCount = firstP.textContent.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < BYLINE_WORD_THRESHOLD) {
      _scanSkip.add(firstP);
      console.log(`[VocaSpot] findArticleBody: skipping first <p> (${wordCount} words, likely byline)`);
    }
  }
}

/**
 * Returns the live DOM node most likely to contain the main article text,
 * or null if nothing found. As a side-effect, populates _scanSkip with
 * byline/author child elements that scanArticle should ignore.
 */
function findArticleBody() {
  _scanSkip.clear();
  let result = null;

  // 1. <article> tag
  const articles = [...document.querySelectorAll('article')].filter(
    el => !isNoisy(el) && !hasNoisyAncestor(el)
  );
  if (articles.length) {
    console.log('[VocaSpot] findArticleBody matched: <article>');
    result = articles[0];
  }

  // 2. <main> tag
  if (!result) {
    const mains = [...document.querySelectorAll('main')].filter(
      el => !isNoisy(el) && !hasNoisyAncestor(el)
    );
    if (mains.length) {
      console.log('[VocaSpot] findArticleBody matched: <main>');
      result = mains[0];
    }
  }

  // 3. Largest <div> with >= 5 <p> children (direct + nested)
  if (!result) {
    const MIN_PARAGRAPHS = 5;
    let bestCount = 0;
    for (const div of document.querySelectorAll('div')) {
      if (isNoisy(div) || hasNoisyAncestor(div)) continue;
      const count = div.querySelectorAll('p').length;
      if (count >= MIN_PARAGRAPHS && count > bestCount) {
        bestCount = count;
        result = div;
      }
    }
    if (result) {
      console.log(`[VocaSpot] findArticleBody matched: largest <div> (${result.querySelectorAll('p').length} <p> elements)`);
    }
  }

  if (!result) {
    console.log('[VocaSpot] findArticleBody: no article body detected');
    return null;
  }

  populateScanSkip(result);
  return result;
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
    console.error('[VocaSpot] Failed to load CEFR wordlist:', err);
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

  console.log(
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
 * Returns words exactly one CEFR level above userLevel, capped at MAX_HIGHLIGHTS.
 * When the cap applies, nouns are kept first, then verbs, then adjectives, then others.
 *
 * @param {Array<{word, lemma, cefrLevel, textNode, offset}>} words
 * @param {string} userLevel  e.g. "B1"
 * @returns {Array<{word, lemma, cefrLevel, textNode, offset}>}
 */
function filterByUserLevel(words, userLevel) {
  const levelIndex = CEFR_ORDER.indexOf(userLevel);
  if (levelIndex === -1) {
    console.warn(`[VocaSpot] Unknown userLevel: "${userLevel}"`);
    return [];
  }

  // C2 is the top level — nothing is one step above it.
  if (levelIndex === CEFR_ORDER.length - 1) return [];

  const targetLevel = CEFR_ORDER[levelIndex + 1];
  const candidates = words.filter(w => w.cefrLevel === targetLevel);

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
}

async function updateWordCount(count) {
  if (count <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const { wordCount = 0, wordCountDate = '' } =
    await chrome.storage.local.get({ wordCount: 0, wordCountDate: '' });
  const existing = wordCountDate === today ? wordCount : 0;
  await chrome.storage.local.set({ wordCount: existing + count, wordCountDate: today });
}

async function main() {
  const { cefrLevel = 'B1', highlightStyle = 'underline-dashed' } =
    await chrome.storage.sync.get({ cefrLevel: 'B1', highlightStyle: 'underline-dashed' });
  console.log(`[VocaSpot] User level: ${cefrLevel}`);

  const articleNode = findArticleBody();
  if (!articleNode) {
    console.log('[VocaSpot] main: no article body found, skipping');
    return;
  }

  let words;
  try {
    words = await scanArticle(articleNode);
  } catch (err) {
    console.error('[VocaSpot] main: scanArticle failed:', err);
    return;
  }

  const filtered = filterByUserLevel(words, cefrLevel);
  console.log(
    `[VocaSpot] main: ${filtered.length} word(s) to highlight:`,
    filtered.map(w => `${w.word} [${w.lemma}] (${w.cefrLevel})`)
  );

  highlightWords(filtered, highlightStyle);
  init();
  updateWordCount(filtered.length).catch(() => {});
}

// Run after the page is idle so we never block initial render or user interaction.
// timeout: 4000 guarantees the callback fires within 4 s even if the page never
// goes fully idle (common on news sites with continuous ad/analytics scripts).
// The typeof guard is a safety net; requestIdleCallback is available in all
// Chromium builds, but an explicit fallback makes the intent clear.
const scheduleIdle = typeof requestIdleCallback === 'function'
  ? cb => requestIdleCallback(cb, { timeout: 4000 })
  : cb => setTimeout(cb, 0);

scheduleIdle(async () => {
  const { disabledSites = [] } = await chrome.storage.sync.get({ disabledSites: [] });
  if (disabledSites.includes(window.location.hostname)) {
    console.log('[VocaSpot] disabled on this site, skipping');
    return;
  }
  main().catch(err => console.error('[VocaSpot] main error:', err));
});

let _rescanTimer = null;

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
