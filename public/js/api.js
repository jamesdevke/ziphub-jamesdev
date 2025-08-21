// lightweight API wrapper that sends/receives JSON and keeps credentials
async function apiFetch(url, opts = {}){
  opts.headers = Object.assign({ 'Accept': 'application/json', 'Content-Type': 'application/json' }, opts.headers || {});
  opts.credentials = 'include';
  const res = await fetch(url, opts);
  let json;
  try { json = await res.json(); } catch(e) { json = null; }
  return json;
}

async function apiPost(url, body){
  return apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

async function apiGet(url){
  return apiFetch(url, { method: 'GET' });
}