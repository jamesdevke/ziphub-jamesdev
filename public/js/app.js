(async function(){
  // ensure user is logged in by calling a protected endpoint
  async function ensureAuth(){
    const r = await apiGet('/api/zips');
    if (!r || r.error) {
      // redirect to login
      location.href = '/public/index.html';
      return false;
    }
    return true;
  }

  if (location.pathname.endsWith('dashboard.html')){
    const ok = await ensureAuth();
    if (!ok) return;

    const uploadArea = document.getElementById('uploadArea');
    const openUploadBtn = document.getElementById('openUploadBtn');
    const uploadForm = document.getElementById('uploadForm');
    const zipsList = document.getElementById('zipsList');
    const refreshBtn = document.getElementById('refreshBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');

    openUploadBtn.addEventListener('click', () => uploadArea.classList.toggle('hidden'));
    refreshBtn.addEventListener('click', loadZips);
    logoutBtn.addEventListener('click', async () => {
      await apiPost('/api/logout', {});
      location.href = '/public/index.html';
    });

    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(uploadForm);
      const file = f.get('zipfile');
      if (!file) { alert('Select a zip file'); return; }
      if (!file.name.endsWith('.zip')) { alert('Only .zip allowed'); return; }
      const form = new FormData();
      form.append('zipfile', file);
      form.append('creatorName', f.get('creatorName'));
      form.append('channel', f.get('channel'));
      form.append('repo', f.get('repo'));
      form.append('moreDetails', f.get('moreDetails'));
      form.append('description', f.get('description'));
      const res = await fetch('/api/upload', { method: 'POST', body: form, credentials: 'include' });
      const j = await res.json();
      if (j && j.ok) { alert('Uploaded'); uploadForm.reset(); loadZips(); } else { alert('Upload failed'); }
    });

    async function loadZips(){
      zipsList.innerHTML = '<p class="muted">Loading...</p>';
      const r = await apiGet('/api/zips');
      if (!r || !r.ok) { zipsList.innerHTML = '<p class="muted">Failed to load</p>'; return; }
      const tpl = document.getElementById('zipCardTpl');
      zipsList.innerHTML = '';
      for (const z of r.zips){
        const el = tpl.content.cloneNode(true);
        el.querySelector('.z-title').textContent = z.originalname;
        el.querySelector('.z-meta').textContent = `${z.creatorName} • ${new Date(z.createdAt).toLocaleString()} • ${Math.round(z.size/1024)} KB`;
        el.querySelector('.z-desc').textContent = z.description || z.moreDetails || '';
        const download = el.querySelector('.download');
        download.href = `/api/download/${z.id}`;
        download.addEventListener('click', async (ev) => {
          ev.preventDefault();
          // simple download by navigating
          location.href = `/api/download/${z.id}`;
        });
        const delBtn = el.querySelector('.delete');
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this ZIP? (admin only)')) return;
          const res = await apiPost(`/api/delete/${z.id}`, {});
          if (res && res.ok) { alert('Deleted'); loadZips(); } else { alert('Delete failed (admin only)'); }
        });
        zipsList.appendChild(el);
      }
    }

    // initial load
    loadZips();
  }
})();