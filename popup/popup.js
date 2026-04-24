const CEFR_DESCRIPTIONS = {
  A1: 'Beginner — basic everyday words',
  A2: 'Elementary — simple familiar topics',
  B1: 'Intermediate — main points of clear text',
  B2: 'Upper-Intermediate — complex texts',
  C1: 'Advanced — implicit meaning',
  C2: 'Proficient — everything with ease',
};

let currentSettings = {
  cefrLevel: 'B1',
  highlightStyle: 'underline-dashed',
  disabledSites: [],
};

async function loadSettings() {
  const stored = await chrome.storage.sync.get({
    cefrLevel: 'B1',
    highlightStyle: 'underline-dashed',
    disabledSites: [],
  });
  currentSettings = { ...currentSettings, ...stored };
}

function applyUI() {
  document.querySelectorAll('.vs-cefr-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === currentSettings.cefrLevel);
  });
  document.getElementById('cefr-desc').textContent =
    CEFR_DESCRIPTIONS[currentSettings.cefrLevel] || '';

  document.querySelectorAll('.vs-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === currentSettings.highlightStyle);
  });
}

async function loadStats() {
  const today = new Date().toISOString().slice(0, 10);
  const { wordCount = 0, wordCountDate = '' } =
    await chrome.storage.local.get({ wordCount: 0, wordCountDate: '' });
  document.getElementById('word-count').textContent =
    wordCountDate === today ? wordCount : 0;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getHostname() {
  const tab = await getActiveTab();
  if (!tab?.url) return null;
  try {
    const u = new URL(tab.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

async function loadSiteToggle() {
  const hostname = await getHostname();
  const toggle = document.getElementById('site-toggle');
  if (!hostname) {
    toggle.disabled = true;
    return;
  }
  toggle.checked = !currentSettings.disabledSites.includes(hostname);
}

async function notifyTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    action: 'settingsUpdated',
    settings: {
      cefrLevel: currentSettings.cefrLevel,
      highlightStyle: currentSettings.highlightStyle,
    },
  }).catch(() => {});
}

function bindEvents() {
  document.querySelectorAll('.vs-cefr-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentSettings.cefrLevel = btn.dataset.level;
      applyUI();
      await chrome.storage.sync.set({ cefrLevel: currentSettings.cefrLevel });
      notifyTab();
    });
  });

  document.querySelectorAll('.vs-swatch').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentSettings.highlightStyle = btn.dataset.style;
      applyUI();
      await chrome.storage.sync.set({ highlightStyle: currentSettings.highlightStyle });
      notifyTab();
    });
  });

  document.getElementById('site-toggle').addEventListener('change', async e => {
    const hostname = await getHostname();
    if (!hostname) return;
    if (e.target.checked) {
      currentSettings.disabledSites =
        currentSettings.disabledSites.filter(h => h !== hostname);
    } else {
      if (!currentSettings.disabledSites.includes(hostname)) {
        currentSettings.disabledSites.push(hostname);
      }
    }
    await chrome.storage.sync.set({ disabledSites: currentSettings.disabledSites });
    notifyTab();
  });
}

async function init() {
  await loadSettings();
  applyUI();
  await Promise.all([loadStats(), loadSiteToggle()]);
  bindEvents();
}

init();
