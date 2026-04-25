const CEFR_DESCRIPTIONS = {
  A1: 'Beginner — basic everyday words',
  A2: 'Elementary — simple familiar topics',
  B1: 'Intermediate — common work and study words',
  B2: 'Upper-Intermediate — complex topic vocabulary',
  C1: 'Advanced — sophisticated and nuanced words',
  C2: 'Proficient — rare and specialised vocabulary',
};

let currentSettings = {
  targetLevel: 'B2',
  highlightStyle: 'underline-dashed',
  disabledSites: [],
};

async function loadSettings() {
  const stored = await chrome.storage.sync.get({
    targetLevel: 'B2',
    highlightStyle: 'underline-dashed',
    disabledSites: [],
  });
  currentSettings = { ...currentSettings, ...stored };
}

function applyUI() {
  document.querySelectorAll('.vs-cefr-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === currentSettings.targetLevel);
  });
  document.getElementById('cefr-desc').textContent =
    CEFR_DESCRIPTIONS[currentSettings.targetLevel] || '';

  document.querySelectorAll('.vs-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.style === currentSettings.highlightStyle);
  });
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
      targetLevel: currentSettings.targetLevel,
      highlightStyle: currentSettings.highlightStyle,
    },
  }).catch(() => {});
}

function bindEvents() {
  document.querySelectorAll('.vs-cefr-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentSettings.targetLevel = btn.dataset.level;
      applyUI();
      await chrome.storage.sync.set({ targetLevel: currentSettings.targetLevel });
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
  await loadSiteToggle();
  bindEvents();
}

init();
