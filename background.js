/**
 * background.js - Consulta Lineas CRT  v17
 * Autor: Pescando Lineas | MIT
 */
'use strict';

/* ── Guardar resultado ─────────────────────────────────────── */
/* Las escrituras a crt67_res se serializan en una cola: las APIs corren en
   paralelo y un read-modify-write concurrente pisaba resultados ajenos. */
let _resQueue = Promise.resolve();
function _updateResults(mutator) {
  _resQueue = _resQueue.then(async () => {
    const r = await chrome.storage.local.get(['crt67_res']);
    const results = r['crt67_res'] || {};
    mutator(results);
    await chrome.storage.local.set({ 'crt67_res': results });
  }).catch(e => console.error('[Pescando Lineas] saveResult:', e));
  return _resQueue;
}

function saveResult(id, name, phones, status, errorMsg, detail) {
  return _updateResults(results => {
    results[id] = {
      id, name,
      phones:   phones   || [],
      found:    Array.isArray(phones) && phones.length > 0,
      url:      '',
      status:   status   || 'ok',
      errorMsg: errorMsg || '',
      detail:   detail   || '',
      ts:       Date.now(),
      date:     new Date().toLocaleString('es-MX'),
      via_api:  true,
    };
  });
}

/* ── Weex ──────────────────────────────────────────────────── */
async function queryWeex(user) {
  try {
    let documentType = 1;
    if (user.tipo === 'moral')                 documentType = 3;
    else if (user.ciudadania === 'extranjero') documentType = 2;
    const resp = await fetch('https://app.weex.mx/ServiceLayer/Legislacion?ex=getDnActiveLines', {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ documentType, searchData: user.identificador.toUpperCase() }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data   = await resp.json();
    const lines  = (data?.obj?.dnActiveByCurpRfc) || [];
    const phones = lines
      .map(l => typeof l === 'string' ? l : (l.dn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('weex', 'Weex', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── MoBig ─────────────────────────────────────────────────── */
async function queryMobig(id, name, candidates, user) {
  try {
    // Endpoint API documentado en README + fallback al endpoint de la webview.
    // Se prueban en orden; el primero que devuelva 200 se usa.

    let resp = null;
    let lastErr = null;
    for (const endpoint of candidates) {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ curp: user.identificador.toUpperCase() }),
        });
        if (r.ok) { resp = r; break; }
        lastErr = 'HTTP ' + r.status + ' en ' + endpoint;
      } catch (e) { lastErr = e.message + ' en ' + endpoint; }
    }
    if (!resp) throw new Error(lastErr || 'no endpoint');
    const data   = await resp.json();
    const lines  = data?.data || [];
    const phones = lines
      .map(l => typeof l === 'string' ? l : (l.dn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult(id, name, phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── Yo Mobile ─────────────────────────────────────────────── */
async function queryYoMobile(user) {
  try {
    const encId = encodeURIComponent(user.identificador.toUpperCase());
    const resp  = await fetch(
      'https://play.prod.yomobile.xyz/api/v1.0/crm/lines/by-personal-id/' + encId + '/',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data   = await resp.json();
    const lines  = data?.results || [];
    const phones = lines
      .map(l => typeof l === 'string' ? l : (l.dn || l.number || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('yo_mobile', 'Yo Mobile', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── IENTC ─────────────────────────────────────────────────── */
const IENTC_BASIC = 'N3U4ZThyNjF0OGwwbnRmZ3I5dmozaWhpN2U6a3FvYzNoYzIyZW9nYmVlazdyZWVzNnZqMW81cHFhMzlxcjg4aWVmZ3A3YT==';

async function queryIentc(user) {
  try {
    const tr = await fetch('https://api-iso-prod.ientc.dev/auth/jwt/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + IENTC_BASIC, 'Accept': 'application/json' },
      body: 'grant_type=client_credentials',
    });
    if (!tr.ok) throw new Error('token HTTP ' + tr.status);
    const { access_token } = await tr.json();
    if (!access_token) throw new Error('no token');

    const param = user.tipo === 'moral' ? 'rfc' : 'curp';
    const resp  = await fetch(
      'https://api-iso-prod.ientc.dev/vinculacion/number/get-phones?' + param + '=' + encodeURIComponent(user.identificador.toUpperCase()),
      { headers: { 'Authorization': 'Bearer ' + access_token, 'Accept': 'application/json' } }
    );
    if (resp.status === 404) { await saveResult('ientc', 'IENTC', [], 'ok', ''); return { ok: true }; }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data   = await resp.json();
    const raw    = Array.isArray(data) ? data : (data?.phones || data?.lines || []);
    const phones = raw.map(l => typeof l === 'string' ? l : (l.dn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('ientc', 'IENTC', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── Sorcel ────────────────────────────────────────────────── */
async function querySorcel(user) {
  try {
    const resp = await fetch('https://www.soriup.mx/consultaR.asp', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'curpa=' + encodeURIComponent(user.identificador.toUpperCase()),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html   = await resp.text();
    const container = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0] || html;
    const phones = [...new Set((container.match(/\b\d{10}\b/g) || []))];
    await saveResult('sorcel', 'Sorcel', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}


/* ── Megamóvil ─────────────────────────────────────────────── */
async function queryMegamovil(user) {
  try {
    const id = encodeURIComponent(user.identificador.toUpperCase());
    const resp = await fetch('https://consultavinculacion.megamovil.mx/validaCURP?curp=' + id, {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const lines = data?.lines || data?.data || data?.subscriptions || [];
    const phones = (Array.isArray(lines) ? lines : [])
      .map(l => typeof l === 'string' ? l : (l.msisdn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('megamovil', 'Megamóvil', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── core.newww.mx (Link Móvil / Newww / Red Águila) ────────── */
async function queryCoreNewww(id, name, brand, user) {
  try {
    const curp = encodeURIComponent(user.identificador.toUpperCase());
    const resp = await fetch(
      'https://core.newww.mx/api/core/consulta_lineas_vinculacion?curp=' + curp + '&brand=' + brand,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const lines = data?.lines || data?.data || [];
    const phones = (Array.isArray(lines) ? lines : [])
      .map(l => typeof l === 'string' ? l : (l.msisdn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult(id, name, phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── Logística ACN (Dua / Fedego! / Flash Mobile) ────────────── */
async function queryLogistica(user) {
  try {
    const id = encodeURIComponent(user.identificador.toUpperCase());
    const resp = await fetch('https://ku.diri.mx/consultaRNU/' + id, {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const arr = await resp.json();
    const phones = (Array.isArray(arr) ? arr : [])
      .map(item => typeof item === 'string' ? item : (item.msisdn || item.numero || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('logistica', 'Dua / Fedego! / Flash Mobile', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── Mirlo ─────────────────────────────────────────────────── */
async function queryMirlo(user) {
  try {
    const idType = user.tipo === 'moral' ? 'by-rfc' : 'by-curp';
    const id = encodeURIComponent(user.identificador.toUpperCase());
    const resp = await fetch(
      'https://apib.mirlo.com/api/v1/regulation/query/' + idType + '/' + id,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const lines = data?.lines || data?.subscriptions || data?.data || [];
    const phones = (Array.isArray(lines) ? lines : [])
      .map(l => typeof l === 'string' ? l : (l.msisdn || l.numero || l.phone || ''))
      .map(s => s.replace(/\D/g, '')).filter(s => s.length === 10);
    await saveResult('mirlo', 'Mirlo', phones, 'ok', '');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/* ── Dispatcher ────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_API_QUERIES') {
    const { user, companies } = msg;
    Promise.all(companies.map(async co => {
      const result = await (async () => {
      try {
        switch (co.id) {
          case 'weex':       return await queryWeex(user);
          case 'mobig': return await queryMobig('mobig', 'MoBig', ['https://mobig.mx/api/vinculacion/search-by-curp'], user);
          case 'mobig_bien': return await queryMobig('mobig_bien', 'MoBig Internet Bienestar', ['https://femaseisa.com/api/vinculacion/search-by-curp'], user);
          case 'yo_mobile':  return await queryYoMobile(user);
          case 'ientc':      return await queryIentc(user);
          case 'sorcel':     return await querySorcel(user);
          case 'megamovil':   return await queryMegamovil(user);
          case 'logistica':   return await queryLogistica(user);
          case 'mirlo':       return await queryMirlo(user);
          case 'link_movil':  return await queryCoreNewww('link_movil',  'Link Móvil',  'lm', user);
          case 'newww':       return await queryCoreNewww('newww',       'Newww',       'nw', user);
          case 'red_aguila':  return await queryCoreNewww('red_aguila',  'Red Águila',  'ra', user);
          default:           return { ok: false, error: 'unknown: ' + co.id };
        }
      } catch (e) { return { ok: false, error: e.message }; }
      })();
      /* Un fallo de API se guarda como status 'error' para que salga en la seccion de errores */
      if (result && !result.ok && !String(result.error || '').startsWith('unknown:')) {
        await saveResult(co.id, co.name || co.id, [], 'error', result.error || 'error');
      }
      return result;
    })).then(results => sendResponse({ ok: true, results }));
    return true;
  }

  if (msg.type === 'QUERY_RESULT') {
    _updateResults(res => {
      res[msg.companyId] = {
        id: msg.companyId, name: msg.companyName,
        phones: msg.phones || [], found: Array.isArray(msg.phones) && msg.phones.length > 0,
        url: msg.url || '', status: msg.status || 'ok', errorMsg: msg.errorMsg || '',
        detail: msg.detail || '',
        ts: Date.now(), date: new Date().toLocaleString('es-MX'),
      };
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
