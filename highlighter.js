function injectStyles(highlightStyle) {
  let style = document.getElementById('vs-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'vs-styles';
    document.head.appendChild(style);
  }

  let decoration, hover;
  if (highlightStyle === 'bg-yellow') {
    decoration = 'background-color: #FEF08A;';
    hover = 'background-color: #FDE047;';
  } else if (highlightStyle === 'underline-dotted') {
    decoration = 'border-bottom: 2px dotted #F97316;';
    hover = 'background-color: rgba(249, 115, 22, 0.1);';
  } else {
    decoration = 'border-bottom: 2px dashed #0D9488;';
    hover = 'background-color: rgba(13, 148, 136, 0.1);';
  }

  style.textContent =
    '.vs-highlight {\n' +
    '  display: inline;\n' +
    '  ' + decoration + '\n' +
    '  cursor: pointer;\n' +
    '  border-radius: 2px;\n' +
    '}\n' +
    '.vs-highlight:hover {\n' +
    '  ' + hover + '\n' +
    '}';
}

/**
 * Wraps each word in wordList with a .vs-highlight <span> directly in the DOM.
 *
 * Words that share a text node are processed in descending offset order so that
 * each splitText() call only affects the right-hand portion of the node —
 * leaving all lower offsets intact for subsequent iterations.
 *
 * @param {Array<{word, lemma, cefrLevel, textNode, offset}>} wordList
 */
function highlightWords(wordList, highlightStyle) {
  injectStyles(highlightStyle);

  // Group items by their source text node so all words in the same node
  // can be sorted and processed together.
  const nodeMap = new Map();
  for (const item of wordList) {
    if (!nodeMap.has(item.textNode)) nodeMap.set(item.textNode, []);
    nodeMap.get(item.textNode).push(item);
  }

  let insertedCount = 0;

  for (const [textNode, items] of nodeMap) {
    // Descending offset order: right-to-left processing keeps all
    // earlier offsets valid after each split modifies the right side.
    items.sort((a, b) => b.offset - a.offset);

    for (const item of items) {
      try {
        // The node may have been detached from the DOM between scan and highlight
        // (e.g. by a live-updating news widget). Skip it rather than crash.
        if (!textNode.parentNode) continue;

        const { offset } = item;
        const wordLength = item.word.length;

        // Defensive: scanArticle guarantees valid offsets, but guard anyway
        // in case the node's content changed after the scan.
        if (offset < 0 || offset + wordLength > textNode.nodeValue.length) continue;

        // Step 1 — split off the text that follows the word, but only when
        // the word doesn't already end at the node boundary (splitText at
        // length would create a superfluous empty text node).
        if (offset + wordLength < textNode.nodeValue.length) {
          textNode.splitText(offset + wordLength);
        }

        // Step 2 — isolate the word into its own text node.
        // After this call: textNode holds text[0..offset-1],
        // wordNode holds text[offset..offset+wordLength-1].
        const wordNode = textNode.splitText(offset);

        // Step 3 — build the highlight span and splice it into the DOM.
        // insertBefore first, then appendChild, so the span lands exactly
        // where wordNode was before wordNode is moved inside it.
        const span = document.createElement('span');
        span.className = 'vs-highlight';
        span.dataset.word = item.word;
        span.dataset.lemma = item.lemma;
        span.dataset.level = item.cefrLevel;

        textNode.parentNode.insertBefore(span, wordNode);
        span.appendChild(wordNode);

        insertedCount++;
      } catch (err) {
        console.warn(`[VocaSpot] highlightWords: failed to wrap "${item.word}":`, err.message);
      }
    }
  }

  console.log(`[VocaSpot] highlightWords: ${insertedCount} span(s) inserted`);
}
