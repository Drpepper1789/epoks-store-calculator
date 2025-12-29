
/* Epok's Store Calculator — single-file SPA (no build tools).
   Works over file:// OR http:// (no CORS fetch required for local data).
*/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtUSD = (n) => '$' + n.toFixed(2);
const fmtM = (v) => (v/1_000_000).toFixed(2) + 'M';
const safeLower = (s) => (s||'').toString().toLowerCase();

const DEFAULT_SETTINGS = {
  mode: 'clean',               // clean | duped
  dupedMult: 0.75,             // estimate: duped = clean * mult
  valuesUrl: '',               // remote URL for values json
  autoRefreshMinutes: 'off',   // off | 5 | 15 | 60
  anchor: null                 // {name, usd} for scaling
};

function loadSettings(){
  try{
    const raw = localStorage.getItem('epok_settings');
    if(!raw) return {...DEFAULT_SETTINGS};
    const obj = JSON.parse(raw);
    return {...DEFAULT_SETTINGS, ...obj};
  }catch{ return {...DEFAULT_SETTINGS}; }
}
function saveSettings(obj){
  localStorage.setItem('epok_settings', JSON.stringify(obj));
}

let settings = loadSettings();
let DATA = window.EPOK_DATA;
let cart = loadLS('epok_cart', []);
let suggestions = loadLS('epok_suggestions', []);

function loadLS(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch{ return fallback; }
}
function saveLS(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}

function getValueMap(){
  const m = new Map();
  (DATA.values||[]).forEach(x => m.set(x.item, x.cashValue));
  return m;
}

function effectiveUSD(shopItem){
  const base = Number(shopItem.usd || 0);
  if(settings.mode === 'duped'){
    if(shopItem.dupedUsd != null) return Number(shopItem.dupedUsd);
    return base * Number(settings.dupedMult || 0.75);
  }
  return base;
}

function navTo(view){
  $$('.navBtn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');

  const titles = {
    shop: ['Shop items', 'Browse everything that has a USD price.'],
    missing: ['Missing Price Items', 'These items are in the values list but not in the shop price list.'],
    cart: ['Cart', ''],
    suggest: ['Suggest items', 'Build a list of items to add to the pricing.'],
    settings: ['Settings', 'Auto-update values, switch to duped mode, and edit prices.']
  };
  $('#viewTitle').textContent = titles[view][0];
  $('#viewSubtitle').textContent = titles[view][1] || '';
}

function uniqueCats(items){
  const s = new Set(items.map(x => x.category).filter(Boolean));
  return Array.from(s).sort((a,b)=>a.localeCompare(b));
}

function buildCategorySelect(selectEl, cats){
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">All categories</option>' + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  // keep selection if still present
  if(cats.includes(current)) selectEl.value = current;
}

function escapeHtml(s){
  return (s||'').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function shopWithValues(){
  const vm = getValueMap();
  return (DATA.shop||[]).map(si => {
    const value = vm.get(si.name) ?? vm.get(si.name.replace(/ \(Texture\)$/, '')) ?? null;
    return {...si, value};
  });
}

function computeBestValueMetric(item){
  if(!item.value || item.value<=0) return Infinity;
  const usd = effectiveUSD(item);
  return usd / (item.value/1_000_000); // USD per 1M
}

function renderShop(){
  const list = shopWithValues();
  const q = safeLower($('#searchShop').value);
  const cat = $('#catShop').value;
  const sort = $('#sortShop').value;

  let filtered = list.filter(x => {
    if(q && !safeLower(x.name).includes(q)) return false;
    if(cat && x.category !== cat) return false;
    return true;
  });

  filtered.sort((a,b)=>{
    if(sort==='usdAsc') return effectiveUSD(a)-effectiveUSD(b);
    if(sort==='usdDesc') return effectiveUSD(b)-effectiveUSD(a);
    if(sort==='valueDesc') return (b.value||0)-(a.value||0);
    if(sort==='nameAsc') return a.name.localeCompare(b.name);
    // best
    return computeBestValueMetric(a)-computeBestValueMetric(b);
  });

  $('#shopGrid').innerHTML = filtered.map(x => shopCard(x)).join('');
  attachCardHandlers('#shopGrid');
  $('#modePill').textContent = 'Mode: ' + (settings.mode==='duped' ? 'Duped (est)' : 'Clean');
  refreshDataStamp();
}

function shopCard(x){
  const usd = effectiveUSD(x);
  const perM = (x.value ? (usd / (x.value/1_000_000)) : null);
  return `
  <div class="card" data-name="${escapeHtml(x.name)}">
    <div class="cardTop">
      <div>
        <div class="cardTitle">${escapeHtml(x.name)}</div>
        <div class="subtle">${escapeHtml(x.category||'')}</div>
      </div>
      <span class="badge">${fmtUSD(usd)}</span>
    </div>
    <div class="cardMeta">
      <span class="metaPill">JBCL: ${x.value ? fmtM(x.value) : '—'}</span>
      <span class="metaPill">USD / 1M: ${perM ? perM.toFixed(2) : '—'}</span>
    </div>
    <div class="cardActions">
      <button class="smallBtn primary" data-action="add">+ Add</button>
      <button class="smallBtn" data-action="anchor">Set as anchor</button>
    </div>
  </div>`;
}

function attachCardHandlers(containerSel){
  const el = $(containerSel);
  el.querySelectorAll('.card').forEach(card=>{
    const name = card.dataset.name;
    card.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const action = btn.dataset.action;
        if(action==='add') addToCart(name);
        if(action==='anchor') setAnchor(name);
      });
    });
  });
}

function getShopItemByName(name){
  return (DATA.shop||[]).find(x => x.name === name) || null;
}

function addToCart(name){
  const item = getShopItemByName(name);
  if(!item) return;
  cart.push({name: item.name, usd: effectiveUSD(item), category: item.category || '', ts: Date.now()});
  saveLS('epok_cart', cart);
  renderCart();
}

function removeFromCart(idx){
  cart.splice(idx,1);
  saveLS('epok_cart', cart);
  renderCart();
}

function renderCart(){
  const total = cart.reduce((s,x)=>s+Number(x.usd||0),0);
  $('#cartTotal').textContent = fmtUSD(total);
  $('#cartMeta').textContent = `${cart.length} item${cart.length===1?'':'s'}`;
  $('#cartList').innerHTML = cart.map((x,i)=>`
    <div class="rowItem">
      <div class="rowLeft">
        <div class="rowTitle">${escapeHtml(x.name)}</div>
        <div class="rowSub">${escapeHtml(x.category||'')}</div>
      </div>
      <div class="rowRight">
        <div class="price">${fmtUSD(Number(x.usd||0))}</div>
        <button class="smallBtn" data-i="${i}" data-action="rm">Remove</button>
      </div>
    </div>
  `).join('');
  $('#cartList').querySelectorAll('button[data-action="rm"]').forEach(b=>{
    b.addEventListener('click', ()=>removeFromCart(Number(b.dataset.i)));
  });
}

function copyCartNames(){
  const names = cart.map(x=>x.name).join('\n');
  navigator.clipboard.writeText(names);
}

function clearCart(){
  cart = [];
  saveLS('epok_cart', cart);
  renderCart();
}

function setAnchor(name){
  const item = getShopItemByName(name);
  if(!item) return;
  settings.anchor = {name: item.name, usd: Number(item.usd||0)};
  saveSettings(settings);
  toast(`Anchor set: ${name} ($${Number(item.usd||0).toFixed(2)} clean)`);
  renderEditList();
}

function scaleAllFromAnchor(){
  const anchor = settings.anchor;
  if(!anchor){ toast('Set an anchor item first.'); return; }
  const target = getShopItemByName(anchor.name);
  if(!target){ toast('Anchor not found in shop list.'); return; }

  const desired = Number(prompt('New CLEAN USD price for anchor item:', String(target.usd ?? anchor.usd ?? ''))) ;
  if(!Number.isFinite(desired) || desired<=0){ toast('Cancelled.'); return; }

  const factor = desired / Number(target.usd || 1);
  DATA.shop = (DATA.shop||[]).map(si => ({...si, usd: round2(Number(si.usd||0) * factor)}));
  // update anchor stored
  settings.anchor = {name: anchor.name, usd: desired};
  saveSettings(settings);
  toast('Scaled all shop prices by x' + factor.toFixed(3));
  renderAll();
}

function round2(n){ return Math.round(n*100)/100; }

function toast(msg){
  // tiny toast at bottom-right
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.position='fixed';
  t.style.right='18px';
  t.style.bottom='18px';
  t.style.padding='10px 12px';
  t.style.border='1px solid rgba(255,255,255,.12)';
  t.style.background='rgba(0,0,0,.55)';
  t.style.backdropFilter='blur(8px)';
  t.style.borderRadius='12px';
  t.style.color='#e6edf3';
  t.style.zIndex='9999';
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .25s'; }, 1600);
  setTimeout(()=>{ t.remove(); }, 2000);
}

function buildMissing(){
  const vm = getValueMap();
  const shopNames = new Set((DATA.shop||[]).map(x=>x.name));
  const missing = (DATA.values||[])
    .map(v => ({name: v.item, value: v.cashValue, category: guessCategory(v.item)}))
    .filter(x => !shopNames.has(x.name));

  const q = safeLower($('#searchMissing').value);
  const cat = $('#catMissing').value;
  const sort = $('#sortMissing').value;

  let filtered = missing.filter(x=>{
    if(q && !safeLower(x.name).includes(q)) return false;
    if(cat && x.category !== cat) return false;
    return true;
  });

  filtered.sort((a,b)=>{
    if(sort==='nameAsc') return a.name.localeCompare(b.name);
    return (b.value||0)-(a.value||0);
  });

  $('#missingGrid').innerHTML = filtered.map(x=>missingCard(x)).join('');
  $('#missingGrid').querySelectorAll('button[data-action="suggest"]').forEach(btn=>{
    btn.addEventListener('click', ()=> addSuggestion(btn.dataset.name, guessCategory(btn.dataset.name)));
  });
  buildCategorySelect($('#catMissing'), uniqueCats(missing));
}

function guessCategory(name){
  const n = safeLower(name);
  if(n.includes('hyper')) return 'HyperChrome';
  // not perfect; user can change in suggestions
  return 'Other';
}

function missingCard(x){
  return `
  <div class="card">
    <div class="cardTop">
      <div>
        <div class="cardTitle">${escapeHtml(x.name)}</div>
        <div class="subtle">${escapeHtml(x.category||'')}</div>
      </div>
      <span class="badge">${fmtM(x.value)}</span>
    </div>
    <div class="cardActions">
      <button class="smallBtn" data-action="suggest" data-name="${escapeHtml(x.name)}">Suggest</button>
    </div>
  </div>`;
}

function renderSuggestions(){
  $('#suggestList').innerHTML = suggestions.map((s,i)=>`
    <div class="rowItem">
      <div class="rowLeft">
        <div class="rowTitle">${escapeHtml(s.name)}</div>
        <div class="rowSub">${escapeHtml(s.category || 'Other')}${s.note? ' • ' + escapeHtml(s.note): ''}</div>
      </div>
      <div class="rowRight">
        <button class="smallBtn" data-i="${i}" data-action="edit">Edit</button>
        <button class="smallBtn" data-i="${i}" data-action="rm">Remove</button>
      </div>
    </div>
  `).join('');

  $('#suggestList').querySelectorAll('button[data-action="rm"]').forEach(b=>{
    b.addEventListener('click', ()=>{ suggestions.splice(Number(b.dataset.i),1); saveLS('epok_suggestions', suggestions); renderSuggestions(); });
  });
  $('#suggestList').querySelectorAll('button[data-action="edit"]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const i = Number(b.dataset.i);
      const cur = suggestions[i];
      const cat = prompt('Category (Vehicle/Rim/Spoiler/Texture/Body Color/Drift/Horn/Furniture/Other):', cur.category || 'Other');
      if(cat===null) return;
      const note = prompt('Optional note:', cur.note || '');
      if(note===null) return;
      suggestions[i] = {...cur, category: cat.trim() || 'Other', note: note.trim()};
      saveLS('epok_suggestions', suggestions);
      renderSuggestions();
    });
  });
}

function addSuggestion(name, category){
  if(!name) return;
  if(suggestions.some(s => s.name === name)){ toast('Already in suggestions'); return; }
  suggestions.push({name, category: category || 'Other', note: ''});
  saveLS('epok_suggestions', suggestions);
  renderSuggestions();
  toast('Added suggestion');
}

function copySuggestions(){
  const lines = suggestions.map(s => `${s.name} — ${s.category}${s.note? ' ('+s.note+')':''}`);
  navigator.clipboard.writeText(lines.join('\n'));
  toast('Copied');
}

function clearSuggestions(){
  suggestions = [];
  saveLS('epok_suggestions', suggestions);
  renderSuggestions();
}

function renderSettingsForm(){
  $('#priceMode').value = settings.mode;
  $('#dupedMult').value = settings.dupedMult;
  $('#valuesUrl').value = settings.valuesUrl;
  $('#autoRefresh').value = settings.autoRefreshMinutes;
  renderEditList();
}

function renderEditList(){
  const q = safeLower($('#editSearch').value);
  const list = (DATA.shop||[]).filter(x => !q || safeLower(x.name).includes(q));
  $('#editList').innerHTML = list.map(si => {
    const anchorTag = settings.anchor?.name===si.name ? ' • anchor' : '';
    return `
      <div class="rowItem">
        <div class="rowLeft">
          <div class="rowTitle">${escapeHtml(si.name)}</div>
          <div class="rowSub">${escapeHtml(si.category || '')}${anchorTag}</div>
        </div>
        <div class="rowRight">
          <div class="price">$${Number(si.usd||0).toFixed(2)}</div>
          <button class="smallBtn" data-action="edit" data-name="${escapeHtml(si.name)}">Edit</button>
        </div>
      </div>
    `;
  }).join('');

  $('#editList').querySelectorAll('button[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const name = btn.dataset.name;
      const item = getShopItemByName(name);
      const val = prompt('New CLEAN USD price:', String(item.usd ?? ''));
      if(val===null) return;
      const num = Number(val);
      if(!Number.isFinite(num) || num<0){ toast('Invalid'); return; }
      item.usd = round2(num);
      saveSettings(settings);
      renderAll();
    });
  });
}

function refreshDataStamp(){
  const stamp = DATA.generatedAt ? new Date(DATA.generatedAt).toLocaleString() : 'local';
  $('#dataStamp').textContent = stamp;
}

async function fetchRemoteValuesIfConfigured(){
  // Option A (default): fetch live values via our Vercel proxy (avoids CORS and keeps a stable URL).
  // Option B: if you set Settings → Custom Values URL, we’ll use that instead.
  const custom = (settings.valuesUrl||'').trim();
  const url = custom || '/api/items?minCash=0';
  try{
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    // Accept either {items:[...]} or a bare array [...]
    const rawItems = Array.isArray(json) ? json : (json.items || json.values || []);
    if(!Array.isArray(rawItems) || rawItems.length === 0) throw new Error('No items returned');

    // Normalize: { item, type, cashValue, dupedValue, demand, trend, lastUpdated }
    DATA.values = rawItems.map(x => ({
      item: x.item || x.name || x.title,
      type: x.type || x.category || x.item_type || x.itemType,
      cashValue: Number(x.cashValue ?? x.cash_value ?? x.cash ?? x.value),
      dupedValue: (x.dupedValue ?? x.duped_value) == null ? null : Number(x.dupedValue ?? x.duped_value),
      demand: x.demand || null,
      trend: x.trend || null,
      lastUpdated: x.lastUpdated || x.last_updated || null
    })).filter(x => x.item && Number.isFinite(x.cashValue));

    DATA.valuesSource = custom ? custom : 'JBCL API (proxied)';
    DATA.generatedAt = new Date().toISOString();
    toast(custom ? 'Custom values loaded' : 'Live values updated');
  }catch(e){
    console.error(e);
    toast('Could not load values: ' + e.message);
  }
}

function setupAutoRefresh(){
  // clear old
  if(window.__epokRefreshTimer) clearInterval(window.__epokRefreshTimer);
  window.__epokRefreshTimer = null;

  const mins = settings.autoRefreshMinutes;
  if(mins==='off') return;
  const ms = Number(mins) * 60_000;
  if(!ms) return;
  window.__epokRefreshTimer = setInterval(async ()=>{
    await fetchRemoteValuesIfConfigured();
    renderAll();
  }, ms);
}

function renderAll(){
  // categories for shop
  buildCategorySelect($('#catShop'), uniqueCats(DATA.shop||[]));
  renderShop();
  buildMissing();
  renderCart();
  renderSuggestions();
  renderEditList();
  setupAutoRefresh();
}

function wireUI(){
  // navigation
  $$('.navBtn').forEach(btn => btn.addEventListener('click', ()=> navTo(btn.dataset.view)));

  // shop
  $('#searchShop').addEventListener('input', renderShop);
  $('#catShop').addEventListener('change', renderShop);
  $('#sortShop').addEventListener('change', renderShop);

  // missing
  $('#searchMissing').addEventListener('input', buildMissing);
  $('#catMissing').addEventListener('change', buildMissing);
  $('#sortMissing').addEventListener('change', buildMissing);
  $('#suggestFromMissingBtn').addEventListener('click', ()=>{
    toast('Tip: click “Suggest” on any missing item card.');
  });

  // cart
  $('#copyNamesBtn').addEventListener('click', ()=>{ copyCartNames(); toast('Copied'); });
  $('#clearCartBtn').addEventListener('click', clearCart);

  // suggest
  $('#addSuggestionBtn').addEventListener('click', ()=>{
    const q = $('#suggestSearch').value.trim();
    if(!q){ toast('Type an item name'); return; }
    const cat = $('#suggestCat').value || 'Other';
    addSuggestion(q, cat);
    $('#suggestSearch').value='';
  });
  $('#copySuggestionsBtn').addEventListener('click', copySuggestions);
  $('#clearSuggestionsBtn').addEventListener('click', clearSuggestions);

  // settings
  $('#saveSettingsBtn').addEventListener('click', async ()=>{
    settings.mode = $('#priceMode').value;
    settings.dupedMult = Number($('#dupedMult').value || 0.75);
    settings.valuesUrl = $('#valuesUrl').value.trim();
    settings.autoRefreshMinutes = $('#autoRefresh').value;
    saveSettings(settings);
    await fetchRemoteValuesIfConfigured();
    renderAll();
    toast('Saved');
  });
  $('#resetSettingsBtn').addEventListener('click', ()=>{
    settings = {...DEFAULT_SETTINGS};
    saveSettings(settings);
    toast('Reset');
    renderSettingsForm();
    renderAll();
  });
  $('#priceMode').addEventListener('change', ()=>{ settings.mode = $('#priceMode').value; saveSettings(settings); renderShop(); renderCart(); });
  $('#dupedMult').addEventListener('input', ()=>{ settings.dupedMult = Number($('#dupedMult').value||0.75); saveSettings(settings); renderShop(); renderCart(); });

  $('#editSearch').addEventListener('input', renderEditList);
  $('#scaleFromAnchorBtn').addEventListener('click', scaleAllFromAnchor);

  $('#refreshBtn').addEventListener('click', async ()=>{
    await fetchRemoteValuesIfConfigured();
    renderAll();
  });

  // auto-cart (simple: pick top 10 best value)
  $('#autoCartBtn').addEventListener('click', ()=>{
    const list = shopWithValues().filter(x=>x.value);
    list.sort((a,b)=> computeBestValueMetric(a)-computeBestValueMetric(b));
    const top = list.slice(0, 10);
    top.forEach(x=>addToCart(x.name));
    toast('Auto-cart added top 10');
  });
}

(async function init(){
  // make sure modes apply
  renderSettingsForm();
  await fetchRemoteValuesIfConfigured();
  wireUI();
  renderAll();
  navTo('shop');
})();
