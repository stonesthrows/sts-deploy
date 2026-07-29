// ════════════════════════════════════════════
//  GOOGLE PHOTOS INTEGRATION  —  js/photos.js
//  Google Photos → Design Library images
// ════════════════════════════════════════════

const PHOTOS_TOKEN_KEY  = 'sts-photos-token';
const PHOTOS_EXPIRY_KEY = 'sts-photos-token-expiry';

let _photosOauthCallback = null;
let _photosAlbums = [];
let _photosSelectedAlbum = null;

// ── Token helpers ────────────────────────────

function getPhotosToken() {
  const token  = localStorage.getItem(PHOTOS_TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(PHOTOS_EXPIRY_KEY) || '0');
  if (token && Date.now() < expiry - 60000) return token; // 1-min safety buffer
  return null;
}

function clearPhotosToken() {
  localStorage.removeItem(PHOTOS_TOKEN_KEY);
  localStorage.removeItem(PHOTOS_EXPIRY_KEY);
}

// ── OAuth flow ───────────────────────────────

function triggerPhotosOAuth(clientId, callback) {
  _photosOauthCallback = callback;
  const redirectUri = window.location.origin + window.location.pathname;
  const scopes = [
    'https://www.googleapis.com/auth/photoslibrary.readonly'
  ].join(' ');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id='     + encodeURIComponent(clientId)
    + '&redirect_uri='  + encodeURIComponent(redirectUri)
    + '&response_type=token'
    + '&scope='         + encodeURIComponent(scopes)
    + '&prompt=select_account';

  const popup = window.open(url, 'google-photos-oauth', 'width=520,height=620,scrollbars=yes,resizable=yes');
  if (!popup) {
    toast('Popup blocked — allow popups for this site and try again', '⚠');
    _photosOauthCallback = null;
  }
}

// Listen for OAuth popup result (reuse the same message handler)
window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin) return;
  if (!e.data || e.data.type !== 'sts-google-oauth') return;
  // Store both general and photos-specific tokens
  localStorage.setItem(PHOTOS_TOKEN_KEY, e.data.token);
  localStorage.setItem(PHOTOS_EXPIRY_KEY, String(Date.now() + parseInt(e.data.expiresIn) * 1000));
  if (_photosOauthCallback) { const cb = _photosOauthCallback; _photosOauthCallback = null; cb(); }
});

// ── Add image from Google Photos ──────────────

async function designsAddImageFromPhotos() {
  designsCloseGearMenu();

  const clientId = localStorage.getItem('sts-google-client-id');
  if (!clientId) {
    openIntegrationsModal();
    toast('Set up your Google Client ID in Integrations first', 'ℹ');
    return;
  }

  let token = getPhotosToken();
  if (!token) {
    triggerPhotosOAuth(clientId, async () => {
      await designsAddImageFromPhotos();
    });
    return;
  }

  // Show album picker
  await showPhotosAlbumPicker(token);
}

async function showPhotosAlbumPicker(token) {
  toast('Loading your Google Photos albums…', '⏳');

  try {
    // Fetch albums
    const resp = await fetch('https://photoslibrary.googleapis.com/v1/albums', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (resp.status === 401) {
      clearPhotosToken();
      toast('Google session expired — click Add from Google Photos to reconnect', '⚠');
      return;
    }

    if (!resp.ok) {
      throw new Error(`Photos API error: ${resp.status}`);
    }

    const data = await resp.json();
    _photosAlbums = data.albums || [];

    if (!_photosAlbums.length) {
      toast('No albums found in Google Photos', 'ℹ');
      return;
    }

    // Show modal with album list
    showPhotosModal(token);
  } catch (e) {
    toast(e.message || 'Failed to load Google Photos', '⚠');
  }
}

function showPhotosModal(token) {
  // Create modal HTML
  const modal = document.createElement('div');
  modal.id = 'photos-picker-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: var(--card-bg);
    border: 1px solid var(--bdr);
    border-radius: 8px;
    padding: 20px;
    max-width: 500px;
    width: 90%;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  `;

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text);';
  title.textContent = '📷 Select a Google Photos album';
  content.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

  _photosAlbums.forEach((album, idx) => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      padding: 12px;
      border: 1px solid var(--bdr);
      background: var(--card-bg);
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      color: var(--text);
      font-size: 14px;
      transition: background 0.2s;
    `;
    btn.textContent = `${album.title} (${album.mediaItemsCount || 0} photos)`;
    btn.onmouseover = () => btn.style.background = 'var(--card-head-bg)';
    btn.onmouseout = () => btn.style.background = 'var(--card-bg)';
    btn.onclick = () => selectPhotosAlbum(album, token, modal);
    list.appendChild(btn);
  });

  content.appendChild(list);

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-outline btn-sm';
  closeBtn.textContent = 'Cancel';
  closeBtn.onclick = () => modal.remove();
  footer.appendChild(closeBtn);
  content.appendChild(footer);

  modal.appendChild(content);
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  document.body.appendChild(modal);
}

async function selectPhotosAlbum(album, token, modal) {
  modal.remove();
  toast(`Loading images from "${album.title}"…`, '⏳');

  try {
    // Fetch media items from album
    const resp = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        albumId: album.id,
        pageSize: 100
      })
    });

    if (!resp.ok) {
      throw new Error(`Photos API error: ${resp.status}`);
    }

    const data = await resp.json();
    const mediaItems = data.mediaItems || [];

    if (!mediaItems.length) {
      toast(`No images in "${album.title}"`, 'ℹ');
      return;
    }

    // Show image picker
    showPhotosImagePicker(album, mediaItems);
  } catch (e) {
    toast(e.message || 'Failed to load album images', '⚠');
  }
}

function showPhotosImagePicker(album, mediaItems) {
  const modal = document.createElement('div');
  modal.id = 'photos-image-picker-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: var(--card-bg);
    border: 1px solid var(--bdr);
    border-radius: 8px;
    padding: 20px;
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  `;

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text);';
  title.textContent = `📷 ${album.title} — Select images to add`;
  content.appendChild(title);

  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  `;

  const selected = new Set();

  mediaItems.forEach((item, idx) => {
    // Only process photos, skip videos
    if (item.mediaMetadata.video) return;

    const thumbUrl = item.baseUrl + '=w200-h200';
    const container = document.createElement('div');
    container.style.cssText = `
      position: relative;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      aspect-ratio: 1;
      background: var(--card-head-bg);
    `;

    const img = document.createElement('img');
    img.src = thumbUrl;
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 1;
      transition: opacity 0.2s;
    `;

    const checkbox = document.createElement('div');
    checkbox.style.cssText = `
      position: absolute;
      top: 6px;
      right: 6px;
      width: 24px;
      height: 24px;
      background: rgba(255,255,255,0.9);
      border: 2px solid var(--text);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      color: var(--text);
      opacity: 0;
      transition: opacity 0.2s;
    `;

    container.appendChild(img);
    container.appendChild(checkbox);

    container.onmouseover = () => {
      checkbox.style.opacity = '1';
      img.style.opacity = selected.has(idx) ? '1' : '0.7';
    };
    container.onmouseout = () => {
      checkbox.style.opacity = selected.has(idx) ? '1' : '0';
      img.style.opacity = '1';
    };

    container.onclick = () => {
      if (selected.has(idx)) {
        selected.delete(idx);
        checkbox.style.opacity = '0';
        img.style.opacity = '1';
      } else {
        const MAX = 10;
        if (selected.size >= MAX) {
          toast(`Max ${MAX} images per design`, '⚠');
          return;
        }
        selected.add(idx);
        checkbox.textContent = '✓';
        checkbox.style.opacity = '1';
        img.style.opacity = '1';
      }
    };

    grid.appendChild(container);
  });

  content.appendChild(grid);

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-outline btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => modal.remove();
  footer.appendChild(cancelBtn);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-gold btn-sm';
  addBtn.textContent = selected.size > 0 ? `✓ Add ${selected.size} image${selected.size !== 1 ? 's' : ''}` : '✓ Add selected';
  addBtn.onclick = () => downloadPhotosImages(Array.from(selected).map(i => mediaItems[i]), modal);
  footer.appendChild(addBtn);

  content.appendChild(footer);

  modal.appendChild(content);
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  document.body.appendChild(modal);
}

async function downloadPhotosImages(selectedItems, modal) {
  modal.remove();

  if (!selectedItems.length) {
    toast('No images selected', '⚠');
    return;
  }

  const MAX = 10;
  if (_designsImgQueue.length >= MAX) {
    toast(`Max ${MAX} images per design`, '⚠');
    return;
  }

  toast(`Downloading ${selectedItems.length} image${selectedItems.length !== 1 ? 's' : ''}…`, '⏳');

  try {
    const files = [];

    for (const item of selectedItems) {
      // Download full-resolution image
      const imageUrl = item.baseUrl + '=d';
      const resp = await fetch('/api/img-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl })
      });

      if (!resp.ok) {
        console.warn(`Failed to download image: ${resp.status}`);
        continue;
      }

      const blob = await resp.blob();
      const filename = item.filename || 'photo.jpg';
      files.push(new File([blob], filename, { type: blob.type }));
    }

    if (files.length) {
      designsHandleImages(files);
      toast(`✓ Added ${files.length} image${files.length !== 1 ? 's' : ''} from Google Photos`, '✓');
    } else {
      toast('Failed to download images', '⚠');
    }
  } catch (e) {
    toast(e.message || 'Failed to add images from Google Photos', '⚠');
  }
}
