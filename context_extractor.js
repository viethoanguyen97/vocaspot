const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'DD', 'DT']);

function findBlockParent(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (BLOCK_TAGS.has(node.tagName)) return node;
    node = node.parentElement;
  }
  return el.parentElement;
}

function extractContext(span) {
  const highlighted = span.textContent.trim();
  const block = findBlockParent(span);
  const fullText = block ? block.textContent : '';

  const sentences = fullText.match(/[^.!?]*[.!?]/g) || [];

  const sentence = sentences.find(s => s.includes(highlighted));

  if (sentence) {
    return {
      sentence: sentence.trim().replace(highlighted, `**${highlighted}**`),
      highlighted,
    };
  }

  return {
    sentence: fullText.slice(0, 100),
    highlighted,
  };
}
