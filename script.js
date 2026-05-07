// ====================== Firebase Config ======================
const firebaseConfig = {
  apiKey: "AIzaSyAu3yLOB6UKRlZ8gnWU7VM9Ts1pGMJzslY",
  authDomain: "stream-tv-50161.firebaseapp.com",
  projectId: "stream-tv-50161",
  storageBucket: "stream-tv-50161.firebasestorage.app",
  messagingSenderId: "415515113346",
  appId: "1:415515113346:web:e7c5800b3c65f8fdd8c19b",
  measurementId: "G-GHE4PRX2YR"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ====================== Global App State ======================
const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const PROXY_URLS = ['https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
let allChannels = [];
let filteredChannels = [];
let currentPage = 1;
const pageSize = 40;
let activeCategory = '';
let activeLanguage = '';
let currentUser = null;
let userDoc = null;
let isAdmin = false;
let isPremium = false;
let kidsMode = false;
const ADMIN_EMAIL = 'noelmwakilasa47@gmail.com';

// DOM cache
const $ = id => document.getElementById(id);
const homeView = $('homeView'), searchView = $('searchView'), profileView = $('profileView');
const recentRow = $('recentRow'), featuredCategories = $('featuredCategories');
const searchBox = $('searchBox'), categoryPills = $('categoryPills'), languagePills = $('languagePills');
const channelGrid = $('channelGrid'), paginationDiv = $('pagination');
const loginBtn = $('loginBtn'), logoutBtn = $('logoutBtn'), userDisplay = $('userDisplay');
const themeToggle = $('themeToggle'), darkThemeToggle = $('darkThemeToggle');
const kidsModeToggle = $('kidsModeToggle');
const profileName = $('profileName'), profileEmail = $('profileEmail'), premiumStatus = $('premiumStatus');
const favList = $('favList'), adminPanel = $('adminPanel');
const statusTextEl = $('statusText');
const playerModal = $('playerModal'), videoPlayer = $('videoPlayer'), channelTitle = $('channelTitle');
const playPauseBtn = $('playPauseBtn'), progressBar = $('progressBar');
const progressFill = $('progressFill'), progressThumb = $('progressThumb'), currentTimeSpan = $('currentTime');
const durationSpan = $('duration'), volumeSlider = $('volumeSlider'), fullscreenBtn = $('fullscreenBtn');
const closePlayerBtn = $('closePlayerBtn'), qualityBtn = $('qualityBtn');
const usernameModal = $('usernameModal'), usernameInput = $('usernameInput');
const setUsernameBtn = $('setUsernameBtn'), usernameError = $('usernameError');
const limitModal = $('limitModal'), closeLimitBtn = $('closeLimitBtn');
const adminModal = $('adminModal'), userListDiv = $('userList'), closeAdminBtn = $('closeAdminBtn');

let hls = null, currentQualityIndex = -1;
let limitTimer = null, limitStart = 0, currentChannel = null;

// ====================== Helper: Parse M3U ======================
function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF')) {
      if (current) channels.push(current);
      const info = t.substring(8);
      const ci = info.indexOf(',');
      let meta = '', name = '';
      if (ci >= 0) {
        meta = info.substring(0, ci).trim();
        name = info.substring(ci + 1).trim();
      } else {
        name = info.trim();
      }
      const ga = (attr) => {
        const m = meta.match(new RegExp(`${attr}="([^"]*)"`));
        return m ? m[1] : '';
      };
      current = {
        displayName: name,
        tvgId: ga('tvg-id'),
        tvgName: ga('tvg-name'),
        tvgLogo: ga('tvg-logo'),
        groupTitle: ga('group-title'),
        language: extractLanguage(ga('tvg-language') || ga('group-title') || ''),
      };
    } else if (t && !t.startsWith('#') && current) {
      current.url = t;
      channels.push(current);
      current = null;
    }
  }
  if (current) channels.push(current);
  return channels;
}

function extractLanguage(raw) {
  const langMap = {
    english: 'English', french: 'French', spanish: 'Spanish',
    german: 'German', italian: 'Italian', portuguese: 'Portuguese',
    russian: 'Russian', arabic: 'Arabic', hindi: 'Hindi',
    turkish: 'Turkish', dutch: 'Dutch', polish: 'Polish',
    indonesian: 'Indonesian', thai: 'Thai', vietnamese: 'Vietnamese',
  };
  const rLow = raw.toLowerCase();
  for (const [key, val] of Object.entries(langMap)) {
    if (rLow.includes(key)) return val;
  }
  return '';
}

// ====================== Auth ======================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    const docRef = db.collection('users').doc(user.uid);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      await docRef.set({
        email: user.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        isPremium: false,
        premiumExpiry: null,
        favorites: [],
        recentlyViewed: [],
        admin: (user.email === ADMIN_EMAIL),
        username: '',
        theme: 'dark',
        kidsMode: false,
      });
    }
    userDoc = docRef;
    await loadUserData();
  } else {
    currentUser = null;
    userDoc = null;
    isAdmin = false;
    isPremium = false;
    kidsMode = false;
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    userDisplay.textContent = '';
    profileName.textContent = 'Stream Viewer';
    profileEmail.textContent = '';
    premiumStatus.textContent = '';
    favList.innerHTML = 'No favorites yet.';
    adminPanel.style.display = 'none';
    applyKidsMode(false);
  }
});

async function loadUserData() {
  const snap = await userDoc.get();
  const data = snap.data();
  currentUser.displayName = data.username || data.email;
  userDisplay.textContent = data.username || data.email.split('@')[0];
  isAdmin = data.admin || false;
  isPremium = data.isPremium && data.premiumExpiry?.toDate() > new Date();
  kidsMode = data.kidsMode || false;
  const savedTheme = data.theme || 'dark';
  applyTheme(savedTheme);
  darkThemeToggle.checked = (savedTheme === 'dark');
  kidsModeToggle.checked = kidsMode;
  applyKidsMode(kidsMode);
  if (isAdmin) adminPanel.style.display = 'block';
  else adminPanel.style.display = 'none';
  profileName.textContent = data.username || 'Set username';
  profileEmail.textContent = currentUser.email;
  premiumStatus.textContent = isPremium
    ? `Premium until ${data.premiumExpiry.toDate().toLocaleDateString()}`
    : 'Free user';
  renderFavorites();
  if (!data.username) showUsernameModal();
  buildHomeRows();
}

// ====================== Login / Logout ======================
loginBtn.addEventListener('click', () => {
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(err => alert('Login failed: ' + err.message));
});
logoutBtn.addEventListener('click', () => auth.signOut());

// Username setup
function showUsernameModal() {
  usernameModal.classList.add('active');
  usernameInput.value = '';
  usernameError.textContent = '';
}
setUsernameBtn.addEventListener('click', async () => {
  const name = usernameInput.value.trim();
  if (name.length < 3) {
    usernameError.textContent = 'At least 3 characters.';
    return;
  }
  const usernameDoc = await db.collection('usernames').doc(name).get();
  if (usernameDoc.exists) {
    usernameError.textContent = 'Username taken.';
    return;
  }
  await db.collection('usernames').doc(name).set({ uid: currentUser.uid });
  await userDoc.update({ username: name });
  usernameModal.classList.remove('active');
  await loadUserData();
});

// ====================== Theme & Kids Mode ======================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  localStorage.setItem('streamtv_theme', theme);
}
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const newTheme = cur === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  if (userDoc) userDoc.update({ theme: newTheme });
});
darkThemeToggle.addEventListener('change', () => {
  const newTheme = darkThemeToggle.checked ? 'dark' : 'light';
  applyTheme(newTheme);
  if (userDoc) userDoc.update({ theme: newTheme });
});

function applyKidsMode(enabled) {
  kidsMode = enabled;
  if (kidsModeToggle) kidsModeToggle.checked = enabled;
  if (homeView.classList.contains('active')) buildHomeRows();
  if (searchView.classList.contains('active')) applyFilters();
}
kidsModeToggle.addEventListener('change', () => {
  applyKidsMode(kidsModeToggle.checked);
  if (userDoc) userDoc.update({ kidsMode: kidsModeToggle.checked });
});

// ====================== Navigation ======================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    homeView.classList.toggle('active', view === 'home');
    searchView.classList.toggle('active', view === 'search');
    profileView.classList.toggle('active', view === 'profile');
    if (view === 'home') buildHomeRows();
    if (view === 'search') applyFilters();
    if (view === 'profile') updateProfile();
  });
});

// ====================== Channel Loading ======================
async function fetchPlaylistText() {
  try {
    const r = await fetch(PLAYLIST_URL);
    if (r.ok) return await r.text();
  } catch (e) {}
  for (const proxy of PROXY_URLS) {
    try {
      const r = await fetch(proxy + encodeURIComponent(PLAYLIST_URL));
      if (r.ok) return await r.text();
    } catch (e) {}
  }
  throw new Error('Failed to load playlist.');
}

async function loadChannels() {
  try {
    statusTextEl.textContent = 'Loading channels…';
    const text = await fetchPlaylistText();
    allChannels = parseM3U(text);
    statusTextEl.textContent = `${allChannels.length} channels ready`;
    setupSearchFilters();
    buildHomeRows();
  } catch (e) {
    statusTextEl.textContent = 'Error: ' + e.message;
    allChannels = [];
  }
}

// ====================== Cards & Rows ======================
function createChannelCard(channel) {
  const card = document.createElement('div');
  card.className = 'channel-card glass';
  const isFav = false;
  card.innerHTML = `
    <div class="live-badge">LIVE</div>
    <div class="viewer-count">${Math.floor(Math.random()*800)+10}K</div>
    <img class="card-img" src="${channel.tvgLogo || 'load.png'}" onerror="this.onerror=null;this.src='load.png';">
    <div class="card-body">
      <div class="card-name">${channel.displayName || 'Unknown'}</div>
      <div class="card-meta">
        <button class="fav-btn ${isFav?'liked':''}"><i class="fas fa-heart"></i></button>
      </div>
    </div>
  `;
  card.addEventListener('click', () => playChannel(channel));
  card.querySelector('.fav-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(channel);
  });
  if (userDoc) {
    userDoc.get().then(snap => {
      const favs = snap.data().favorites || [];
      if (favs.includes(channel.url)) {
        card.querySelector('.fav-btn').classList.add('liked');
      }
    });
  }
  return card;
}

async function toggleFavorite(channel) {
  if (!userDoc) {
    alert('Please login to save favorites.');
    return;
  }
  const snap = await userDoc.get();
  const favs = snap.data().favorites || [];
  const url = channel.url;
  const index = favs.indexOf(url);
  if (index > -1) favs.splice(index, 1);
  else favs.push(url);
  await userDoc.update({ favorites: favs });
  document.querySelectorAll('.channel-card').forEach(card => {
    if (card.querySelector('.card-name')?.textContent === channel.displayName) {
      card.querySelector('.fav-btn').classList.toggle('liked', favs.includes(url));
    }
  });
  if (profileView.classList.contains('active')) renderFavorites();
}

function getChannelsByCategory(cat, src = allChannels) {
  const keys = (CATEGORY_MAP[cat] || [cat.toLowerCase()]);
  return src.filter(ch => {
    const g = (ch.groupTitle || '').toLowerCase();
    return keys.some(k => g.includes(k));
  });
}

const CATEGORY_MAP = {
  'Sports': ['sports','sport'],
  'Movies': ['movies','movie','film'],
  'Kids': ['kids','child','cartoon'],
  'Music': ['music','musical'],
  'News': ['news','information'],
  'Documentary': ['documentary','docu'],
  'Religion': ['religion','religious','faith'],
};

function buildHomeRows() {
  renderRecentlyViewed();
  featuredCategories.innerHTML = '';
  let cats = ['News','Sports','Movies','Music','Kids','Documentary','Religion'];
  if (kidsMode) cats = ['Kids'];
  cats.forEach(cat => {
    const chs = getChannelsByCategory(cat);
    if (!chs.length) return;
    const sec = document.createElement('div');
    sec.className = 'category-section';
    sec.innerHTML = `<div class="category-header"><i class="fas fa-tv"></i> ${cat}</div>`;
    const row = document.createElement('div');
    row.className = 'scroll-row';
    chs.slice(0, 35).forEach(ch => row.appendChild(createChannelCard(ch)));
    sec.appendChild(row);
    featuredCategories.appendChild(sec);
  });
}

async function renderRecentlyViewed() {
  recentRow.innerHTML = '';
  if (!userDoc) return;
  const snap = await userDoc.get();
  const recent = snap.data().recentlyViewed || [];
  if (recent.length === 0) return;
  recentRow.innerHTML = `<div class="category-section"><div class="category-header"><i class="fas fa-history"></i> Recently Viewed</div><div class="scroll-row" id="recentScroller"></div></div>`;
  const scroller = document.getElementById('recentScroller');
  if (!scroller) return;
  recent.forEach(ch => scroller.appendChild(createChannelCard(ch)));
}

async function addToRecentlyViewed(channel) {
  if (!userDoc) return;
  const snap = await userDoc.get();
  let recent = snap.data().recentlyViewed || [];
  recent = recent.filter(r => r.url !== channel.url);
  recent.unshift({
    url: channel.url,
    displayName: channel.displayName,
    tvgLogo: channel.tvgLogo,
    groupTitle: channel.groupTitle,
  });
  if (recent.length > 20) recent.length = 20;
  await userDoc.update({ recentlyViewed: recent });
  if (homeView.classList.contains('active')) renderRecentlyViewed();
}

// ====================== Play & Limit ======================
function playChannel(channel) {
  currentChannel = channel;
  channelTitle.textContent = channel.displayName;
  playerModal.classList.add('active');
  if (Hls.isSupported()) {
    if (hls) hls.destroy();
    hls = new Hls();
    hls.loadSource(channel.url);
    hls.attachMedia(videoPlayer);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoPlayer.play();
      qualitySetup();
      startLimitTimer();
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
          case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
          default: hls.destroy(); break;
        }
      }
    });
  } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    videoPlayer.src = channel.url;
    videoPlayer.play();
  } else {
    alert('HLS playback not supported.');
  }
  addToRecentlyViewed(channel);
  bindPlayerControls();
}

function startLimitTimer() {
  clearTimeout(limitTimer);
  const isKids = (currentChannel.groupTitle || '').toLowerCase().includes('kids');
  if (isKids || isAdmin) return;
  if (isPremium) return;
  limitTimer = setTimeout(() => {
    videoPlayer.pause();
    playerModal.classList.remove('active');
    limitModal.classList.add('active');
  }, 180000);
}
closeLimitBtn.addEventListener('click', () => limitModal.classList.remove('active'));

function qualitySetup() {
  if (!hls || !hls.levels.length) { qualityBtn.style.display = 'none'; return; }
  qualityBtn.style.display = 'inline-block';
  qualityBtn.textContent = 'Auto';
  currentQualityIndex = -1;
  qualityBtn.onclick = () => {
    if (currentQualityIndex === -1) {
      const hd = hls.levels.length - 1;
      hls.currentLevel = hd;
      currentQualityIndex = hd;
      qualityBtn.textContent = 'HD';
    } else if (currentQualityIndex === hls.levels.length - 1) {
      hls.currentLevel = 0;
      currentQualityIndex = 0;
      qualityBtn.textContent = 'SD';
    } else {
      hls.currentLevel = -1;
      currentQualityIndex = -1;
      qualityBtn.textContent = 'Auto';
    }
  };
}

function closePlayer() {
  playerModal.classList.remove('active');
  if (hls) { hls.destroy(); hls = null; }
  clearTimeout(limitTimer);
  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
}
closePlayerBtn.addEventListener('click', closePlayer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });

function bindPlayerControls() {
  playPauseBtn.onclick = () => videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
  videoPlayer.onplay = () => playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  videoPlayer.onpause = () => playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  videoPlayer.ontimeupdate = () => {
    const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100 || 0;
    progressFill.style.width = pct + '%';
    if (progressThumb) progressThumb.style.left = pct + '%';
    currentTimeSpan.textContent = formatTime(videoPlayer.currentTime);
  };
  videoPlayer.ondurationchange = () => { durationSpan.textContent = formatTime(videoPlayer.duration); };
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    videoPlayer.currentTime = ratio * videoPlayer.duration;
  });
  volumeSlider.oninput = () => videoPlayer.volume = volumeSlider.value;
  fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
      if (videoPlayer.requestFullscreen) videoPlayer.requestFullscreen();
      else if (videoPlayer.webkitRequestFullscreen) videoPlayer.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };
}

function formatTime(sec) {
  if (isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ====================== Search & Filters ======================
function setupSearchFilters() {
  const cats = Object.keys(CATEGORY_MAP);
  const langs = [...new Set(allChannels.map(c => c.language).filter(l => l))];
  
  categoryPills.innerHTML = '';
  cats.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = cat;
    pill.addEventListener('click', () => {
      document.querySelectorAll('#categoryPills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = cat;
      currentPage = 1;
      applyFilters();
    });
    categoryPills.appendChild(pill);
  });
  
  languagePills.innerHTML = '';
  langs.forEach(lang => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = lang;
    pill.addEventListener('click', () => {
      document.querySelectorAll('#languagePills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeLanguage = lang;
      currentPage = 1;
      applyFilters();
    });
    languagePills.appendChild(pill);
  });
}

function applyFilters() {
  let filtered = allChannels;
  
  if (activeCategory) {
    filtered = getChannelsByCategory(activeCategory, filtered);
  }
  
  if (activeLanguage) {
    filtered = filtered.filter(ch => ch.language === activeLanguage);
  }
  
  const searchTerm = searchBox.value.toLowerCase();
  if (searchTerm) {
    filtered = filtered.filter(ch => 
      ch.displayName.toLowerCase().includes(searchTerm) || 
      (ch.groupTitle || '').toLowerCase().includes(searchTerm)
    );
  }
  
  if (kidsMode) {
    filtered = filtered.filter(ch => 
      (ch.groupTitle || '').toLowerCase().includes('kids')
    );
  }
  
  filteredChannels = filtered;
  currentPage = 1;
  renderSearchGrid();
}

function renderSearchGrid() {
  channelGrid.innerHTML = '';
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageChannels = filteredChannels.slice(start, end);
  pageChannels.forEach(ch => channelGrid.appendChild(createChannelCard(ch)));
  renderPagination();
}

function renderPagination() {
  paginationDiv.innerHTML = '';
  const totalPages = Math.ceil(filteredChannels.length / pageSize);
  if (totalPages <= 1) return;
  
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Prev';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderSearchGrid();
    }
  });
  paginationDiv.appendChild(prevBtn);
  
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  paginationDiv.appendChild(pageInfo);
  
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderSearchGrid();
    }
  });
  paginationDiv.appendChild(nextBtn);
}

searchBox.addEventListener('input', applyFilters);

// ====================== Profile & Admin ======================
async function updateProfile() {
  if (!userDoc) {
    profileName.textContent = 'Please login';
    return;
  }
  const data = (await userDoc.get()).data();
  profileName.textContent = data.username || 'Unknown';
  profileEmail.textContent = currentUser.email;
  const prem = data.isPremium && data.premiumExpiry?.toDate() > new Date();
  premiumStatus.textContent = prem ? `Premium until ${data.premiumExpiry.toDate().toLocaleDateString()}` : 'Free user';
  renderFavorites();
}

async function renderFavorites() {
  favList.innerHTML = '';
  if (!userDoc) return;
  const data = (await userDoc.get()).data();
  const favs = data.favorites || [];
  if (favs.length === 0) {
    favList.innerHTML = 'No favorites yet.';
    return;
  }
  favs.forEach(url => {
    const ch = allChannels.find(c => c.url === url);
    if (ch) {
      const chip = document.createElement('span');
      chip.className = 'fav-chip';
      chip.textContent = ch.displayName;
      chip.addEventListener('click', () => playChannel(ch));
      favList.appendChild(chip);
    }
  });
}

// Admin
$('adminUsersBtn').addEventListener('click', async () => {
  adminModal.classList.add('active');
  const usersSnap = await db.collection('users').get();
  userListDiv.innerHTML = '';
  usersSnap.forEach(doc => {
    const data = doc.data();
    const item = document.createElement('div');
    item.className = 'user-item';
    item.innerHTML = `
      <span>${data.email} ${data.admin ? '(Admin)' : ''}</span>
      <button onclick="toggleAdminStatus('${doc.id}', ${!data.admin})" class="scan-btn" style="padding:0.3rem 0.6rem;font-size:0.8rem;">
        ${data.admin ? 'Remove Admin' : 'Make Admin'}
      </button>
    `;
    userListDiv.appendChild(item);
  });
});

closeAdminBtn.addEventListener('click', () => adminModal.classList.remove('active'));

async function toggleAdminStatus(uid, makeAdmin) {
  try {
    await db.collection('users').doc(uid).update({ admin: makeAdmin });
    $('adminUsersBtn').click();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ====================== Initialize App ======================
window.addEventListener('load', () => {
  loadChannels();
  const savedTheme = localStorage.getItem('streamtv_theme') || 'dark';
  applyTheme(savedTheme);
});
