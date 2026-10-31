/**
 * content.js - Consulta Lineas CRT
 * Autor: Pescando Lineas | MIT
 *
 * v9 - Correcciones basadas en DOM real observado:
 *
 * DALEFON: radio name="tipoPersona" value="curp"|"rfc"|"pasaporte"
 *   inputs especificos: id="input-linked-line-rfc", id="input-linked-line-pasaporte"
 *
 * INTERNET BIENESTAR (Dalefon): radio name="tipoPersona" value="fisica"|"moral"|"extranjero"
 *   input MUI con placeholder="RFC" o "Pasaporte" segun seleccion
 */
'use strict';

const K_USER = 'crt67_user';
const K_TS   = 'crt67_uts';
const TTL    = 86400000;

/* ── Utilidades ──────────────────────────────────────────── */
function setVal(input, value) {
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (proto && proto.set) proto.set.call(input, value);
  else input.value = value;
  ['input','change','blur'].forEach(t =>
    input.dispatchEvent(new Event(t, { bubbles:true, cancelable:true }))
  );
}

function setAngularVal(input, value) {
  input.focus();
  input.dispatchEvent(new Event('focus', { bubbles:true }));
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (proto && proto.set) proto.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new InputEvent('input', {
    bubbles:true, cancelable:true, inputType:'insertText', data:value,
  }));
  input.dispatchEvent(new Event('change', { bubbles:true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true }));
}

function click(el) {
  if (!el) return;
  ['mousedown','mouseup','click'].forEach(t =>
    el.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true }))
  );
}

function waitFor(sel, ms) {
  ms = ms || 12000;
  return new Promise((ok, fail) => {
    const el = document.querySelector(sel);
    if (el) return ok(el);
    const obs = new MutationObserver(() => {
      const found = document.querySelector(sel);
      if (found) { obs.disconnect(); ok(found); }
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(() => { obs.disconnect(); fail(new Error('timeout: '+sel)); }, ms);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function banner(msg, color) {
  const old = document.getElementById('crt67-b');
  if (old) old.remove();
  const b = document.createElement('div');
  b.id = 'crt67-b';
  b.textContent = msg;
  Object.assign(b.style, {
    position:'fixed', top:'0', left:'0', right:'0', zIndex:'2147483647',
    background: color||'#1E3A8A', color:'#fff',
    fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
    fontSize:'13px', fontWeight:'600', padding:'10px 16px',
    textAlign:'center', boxShadow:'0 2px 8px rgba(0,0,0,.35)', lineHeight:'1.5',
  });
  document.body.appendChild(b);
}

/* ── Guardar resultado ───────────────────────────────────── */
function saveResult(id, name, phones, status, errorMsg, autoClose, detail) {
  const msg = {
    type:'QUERY_RESULT', companyId:id, companyName:name,
    phones:phones||[], url:location.href,
    status:status||'ok', errorMsg:errorMsg||'',
    detail: detail||'',
  };
  /* El guardado normal lo hace el service worker (con cola). Si no responde
     (SW dormido/reiniciando) se reintenta antes de caer al guardado directo. */
  const fallbackSave = () => {
    chrome.storage.local.get(['crt67_res'], r => {
      const res = r['crt67_res']||{};
      res[id] = Object.assign({}, msg, {
        found: Array.isArray(phones) && phones.length>0,
        ts: Date.now(), date: new Date().toLocaleString('es-MX'),
        url: msg.url || location.href,
        via_api: false,
      });
      chrome.storage.local.set({ 'crt67_res': res });
    });
  };
  const send = (attempt) => {
    try {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError || !resp) {
          if (attempt < 2) setTimeout(() => send(attempt + 1), 400 * (attempt + 1));
          else fallbackSave();
        }
      });
    } catch (e) { fallbackSave(); }
  };
  send(0);
  if (autoClose) setTimeout(() => window.close(), 2500);
}

/* ── Deteccion de resultados ─────────────────────────────── */
const NEGATIVE_KW = [
  'no se encontr','no hay lineas','sin líneas','sin lineas','no registr',
  'no existen líneas','no existen lineas','no tiene líneas','no tiene lineas',
  'no hay registros','no lines found','no se encontró una vinculación',
  'no encontramos líneas','no encontramos lineas',
  'no hay números vinculados','no hay numeros vinculados',
  'no lines','ninguna línea','ninguna linea','0 líneas','0 lineas',
  'no cuentas con líneas','no cuentas con lineas',
  'no se encontraron lineas',
  /* Mirlo especifico */
  'no hay líneas telefónicas vinculadas',
  'no hay lineas telefonicas vinculadas','no tienes líneas mirlo',
];
const POSITIVE_KW = [
  'línea registrada','linea registrada','número registrado','numero registrado',
  'líneas asociadas','lineas asociadas','líneas vinculadas','lineas vinculadas',
  'lineas encontradas','líneas encontradas','línea activa','linea activa',
  'teléfonos registrados','telefonos registrados',
  'listado de líneas','listado de lineas','numero asociado','número asociado',
];
const EXCLUDE_SELS = ['footer','nav','header','aside','[class*="footer"]','[id*="footer"]'];

function checkPage() {
  const text = (document.body.innerText||'').toLowerCase();
  if (POSITIVE_KW.some(kw => text.includes(kw))) return 'positive';
  if (NEGATIVE_KW.some(kw => text.includes(kw))) return 'negative';
  return null;
}

function extractPhones() {
  const clone = document.body.cloneNode(true);
  EXCLUDE_SELS.forEach(s => clone.querySelectorAll(s).forEach(el => el.remove()));
  const text = clone.innerText||clone.textContent||'';
  if (!POSITIVE_KW.some(kw => text.toLowerCase().includes(kw))) return [];
  const re  = /\b(\d{2}[\s\-]?\d{4}[\s\-]?\d{4}|\d{10})\b/g;
  const raw = text.match(re)||[];
  return [...new Set(raw.map(p => p.replace(/[\s\-]/g,'')).filter(p => p.length===10))];
}

function handleResult(id, name, result, autoClose, detail) {
  if (result==='positive') {
    const phones = extractPhones();
    saveResult(id, name, phones, 'ok', '', autoClose, detail||'');
    banner(
      phones.length>0
        ? 'Se encontraron '+phones.length+' linea(s). Guardado.'+(autoClose?' Esta pestana se cerrara.':'')
        : 'Sin numeros registrados. Guardado.'+(autoClose?' Esta pestana se cerrara.':''),
      phones.length>0 ? '#15803D' : '#1E3A8A'
    );
  } else {
    saveResult(id, name, [], 'ok', '', autoClose, detail||'');
    banner('Sin lineas registradas. Guardado.'+(autoClose?' Esta pestana se cerrara.':''), '#1E3A8A');
  }
}

async function watchResults(id, name, autoClose, querySubmitted, detail) {
  if (querySubmitted) await querySubmitted;
  await sleep(500);
  let done = false;
  const obs = new MutationObserver(async () => {
    if (done) return;
    const result = checkPage();
    if (result) {
      done=true; obs.disconnect();
      await sleep(400);
      handleResult(id, name, result, autoClose, detail);
    }
  });
  obs.observe(document.body, { childList:true, subtree:true, characterData:true });
  setTimeout(() => {
    if (!done) { obs.disconnect(); const r=checkPage(); if(r) handleResult(id,name,r,autoClose,detail); }
  }, 90000);
}

function detectPageError() {
  const all = ((document.body.innerText||'')+' '+(document.title||'')).toLowerCase();
  const checks = [
    {k:'próximamente',              m:'El servicio aun no esta habilitado (Proximamente).'},
    {k:'proximamente',              m:'El servicio aun no esta habilitado (Proximamente).'},
    {k:'403 forbidden',             m:'El portal bloquea el acceso (403).'},
    {k:'connection timed out',      m:'El portal no responde (timeout).'},
    {k:'error 522',                 m:'El servidor esta caido (Error 522 Cloudflare).'},
    {k:'error 524',                 m:'Timeout del servidor (Error 524 Cloudflare).'},
    {k:'this website uses a security service', m:'Bloqueado por Cloudflare.'},
    {k:'performing security verification',     m:'Bloqueado por Cloudflare.'},
  ];
  for (const {k,m} of checks) if (all.includes(k)) return m;
  return null;
}

/* ─────────────────────────────────────────────────────────
   RELLENADORES ESPECIFICOS
   ───────────────────────────────────────────────────────── */

/* ── Altan (CURP / RFC / Pasaporte) ─────────────────────── */
async function fillAltan(user) {
  try {
    const curpInput = await waitFor('input[placeholder="CURP"], input[placeholder*="CURP"]');
    await sleep(800);

    /* Tipo de persona */
    const tipoText = user.tipo==='moral' ? 'Persona moral' : 'Persona física';
    let found = false;
    for (const el of document.querySelectorAll('p,span,label,button,div')) {
      if (el.children.length>0) continue;
      const t = el.textContent.trim();
      if (t===tipoText || t===tipoText.replace('í','i')) { click(el); found=true; break; }
    }
    if (!found) {
      const radios = document.querySelectorAll('input[type="radio"]');
      if (radios.length) click(user.tipo==='moral' ? radios[1] : radios[0]);
    }
    await sleep(300);

    /* Ciudadania (solo fisicas) */
    if (user.tipo!=='moral') {
      const ciudText = user.ciudadania==='extranjero' ? 'Ciudadano extranjero' : 'Ciudadano mexicano';
      for (const el of document.querySelectorAll('p,span,label,button,div')) {
        if (el.children.length>0) continue;
        if (el.textContent.trim()===ciudText) { click(el); break; }
      }
      await sleep(300);
    }

    setVal(curpInput, user.identificador.toUpperCase());
    await sleep(200);

    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (!cb.checked) { click(cb); await sleep(150); }
    }

    banner('Datos prellenados. Resuelve el CAPTCHA y haz clic en Buscar.', '#1E3A8A');

    watchResults('altan','Altan Redes (~69 companias)', false, undefined, '2y2x, Abafon, Abix, Addinteli, AI Telecomm, Appcel, BienCel, Bigcel, Bromovil, CFE Telecom, Chip Macropay, CoolMobile, Comunicaciones Green, Conect2, Diri Movil, ENI Networks, Fangio Mobile, Fibracell, FRC Mobile, Gamers, Gane, Glovo Telecom, Gmovil, Grupo Inten, Hashtag, I AM Abundance, Interlinked, Inxel, Iusatel, Kolors Mobile, Maifon, Mexico Movil, Mexfon, Mi Movil/Altan, MobileArionet, Movired, Movil para Todos, Nabi, Netmas, On-Link, OUI/Altan, Othisi Mobile, PilloFon, Playcell, Red Blak, Red Dog, Redicoppel, Retemex, RETESEC, Rincel, Secure Witness, Sfon, Spot 1, Starline, Telefonica Luna, Telgen, Telmovil, Teracel, TIC-OMV, Tuis, TurboCel, Turbored, Ultracel, Vasanta, VivaMX, Wiki Katat, Wimotelecom, Wiicel, ALLCE');
  } catch(err) {
    banner('No se pudo prellenar. Ingresa los datos manualmente.', '#B91C1C');
  }
}

/* ── Dalefon (radio name="tipoPersona" value="curp|rfc|pasaporte") ─ */
async function fillDalefon(user) {
  try {
    await sleep(1800);

    /* Seleccionar radio correcto */
    let radioVal;
    if (user.tipo==='moral') {
      radioVal = 'rfc';
    } else if (user.ciudadania==='extranjero') {
      radioVal = 'pasaporte';
    } else {
      radioVal = 'curp';
    }
    const radio = document.querySelector(`input[type="radio"][name="tipoPersona"][value="${radioVal}"]`);
    if (radio) { click(radio); await sleep(600); }

    /* Input especifico segun tipo */
    let input = null;
    if (user.tipo==='moral') {
      input = document.querySelector('#input-linked-line-rfc, input[name="rfc"], input[placeholder="RFC"]');
    } else if (user.ciudadania==='extranjero') {
      input = document.querySelector('#input-linked-line-pasaporte, input[name="pasaporte"], input[placeholder="Pasaporte"]');
    } else {
      /* CURP: input generico que aparece por defecto */
      for (let i=0; i<10; i++) {
        input = document.querySelector(
          'input[placeholder*="CURP"], input[type="text"][maxlength="18"], #input-linked-line-curp'
        );
        if (input) break;
        await sleep(400);
      }
    }

    if (!input) throw new Error('input no encontrado para tipo '+radioVal);
    setVal(input, user.identificador.toUpperCase());
    await sleep(500);

    /* Boton Continuar */
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent||'').trim().toLowerCase()==='continuar' && !b.disabled
    );
    let submitResolve;
    const submitted = new Promise(r => { submitResolve=r; });
    if (btn) { click(btn); submitResolve(); banner('Consulta enviada automaticamente en Dalefon.','#15803D'); }
    else { banner('Datos prellenados en Dalefon. Haz clic en Continuar.','#1E3A8A'); setTimeout(submitResolve,60000); }
    watchResults('dalefon','Dalefon', true, submitted);
  } catch(err) {
    banner('No se pudo prellenar Dalefon. Ingresa los datos manualmente.','#B91C1C');
  }
}

/* ── Internet Bienestar / Dalefon Bien
      (MUI React, radio value="fisica|moral|extranjero",
       input MUI con placeholder dinamico)                   ── */
async function fillDalefonBien(user) {
  try {
    await sleep(2000);

    /* Radio tipo */
    let radioVal;
    if (user.tipo==='moral') {
      radioVal = 'moral';
    } else if (user.ciudadania==='extranjero') {
      radioVal = 'extranjero';
    } else {
      radioVal = 'fisica';
    }
    const radio = document.querySelector(`input[type="radio"][name="tipoPersona"][value="${radioVal}"]`);
    if (radio) { click(radio); await sleep(600); }

    /* Input MUI — aparece despues de seleccionar el radio
       placeholder cambia a "RFC", "Pasaporte" o el de CURP segun seleccion */
    let input = null;
    for (let i=0; i<15; i++) {
      if (user.tipo==='moral') {
        input = document.querySelector('input[placeholder="RFC"], input.MuiInputBase-input[placeholder="RFC"]');
      } else if (user.ciudadania==='extranjero') {
        input = document.querySelector('input[placeholder="Pasaporte"], input.MuiInputBase-input[placeholder="Pasaporte"]');
      } else {
        input = document.querySelector(
          'input[placeholder*="CURP"], input[type="text"][maxlength="18"], ' +
          'input.MuiInputBase-input:not([placeholder="RFC"]):not([placeholder="Pasaporte"])'
        );
      }
      if (input) break;
      await sleep(400);
    }
    if (!input) throw new Error('input MUI no encontrado');

    /* MUI usa el setter nativo — setVal normal funciona aqui */
    setVal(input, user.identificador.toUpperCase());
    await sleep(500);

    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent||'').trim().toLowerCase()==='continuar' && !b.disabled
    );
    let submitResolve;
    const submitted = new Promise(r => { submitResolve=r; });
    if (btn) { click(btn); submitResolve(); banner('Consulta enviada automaticamente en Dalefon Bienestar.','#15803D'); }
    else { banner('Datos prellenados en Dalefon Bienestar. Haz clic en Continuar.','#1E3A8A'); setTimeout(submitResolve,60000); }
    watchResults('dalefon_bien','Dalefon Internet Bienestar', true, submitted);
  } catch(err) {
    banner('No se pudo prellenar Dalefon Bienestar. Ingresa los datos manualmente.','#B91C1C');
  }
}

/* ── TurboRails: Mi Movil, Mosi, Redphone ─────────────────── */
async function fillTurboRails(user, id, name) {
  try {
    const input = await waitFor('#identifier, input[name="identifier"]');
    await sleep(600);
    setVal(input, user.identificador.toUpperCase());
    await sleep(400);
    const btn = document.querySelector('input[type="submit"][name="commit"]');
    let submitResolve;
    const submitted = new Promise(r => { submitResolve=r; });
    if (btn && !btn.disabled) { click(btn); submitResolve(); banner('Consulta enviada.','#1E3A8A'); }
    else { banner('Datos prellenados. Haz clic en Consultar.','#1E3A8A'); setTimeout(submitResolve,60000); }
    /* Auto-recarga si "verificacion de seguridad fallida" */
    let reloaded = false;
    const secObs = new MutationObserver(async () => {
      if (reloaded) return;
      const text = (document.body.innerText||'').toLowerCase();
      if (text.includes('verificación de seguridad fallida')||text.includes('verificacion de seguridad fallida')) {
        reloaded=true; secObs.disconnect();
        banner('Error de seguridad. Recargando...','#F97316');
        await sleep(1200); location.reload();
      }
    });
    secObs.observe(document.body, { childList:true, subtree:true, characterData:true });
    setTimeout(() => secObs.disconnect(), 20000);
    watchResults(id, name, true, submitted);
  } catch(err) {
    banner('No se pudo prellenar '+name+'.','#B91C1C');
  }
}

/* ── Oxio (Angular, formcontrolname="curp") ─────────────── */
async function fillOxio(user) {
  try {
    const input = await waitFor('input[formcontrolname="curp"]');
    await sleep(1200);
    setAngularVal(input, user.identificador.toUpperCase());
    await sleep(800);
    const btn = document.querySelector('button[nztype="primary"], button.ant-btn-primary');
    let submitResolve;
    const submitted = new Promise(r => { submitResolve=r; });
    if (btn && !btn.disabled) { click(btn); submitResolve(); banner('Consulta enviada en Oxio.','#15803D'); }
    else { banner('CURP prellenado en Oxio. Haz clic en Search.','#1E3A8A'); setTimeout(submitResolve,60000); }
    watchResults('oxio','Oxio', true, submitted);
  } catch(err) {
    banner('No se pudo prellenar Oxio.','#B91C1C');
  }
}

/* ── Generico sin CAPTCHA ────────────────────────────────── */
async function fillGenericAuto(user, id, name, opts) {
  opts = opts||{};
  try {
    await sleep(opts.delay||1500);
    const sels = [
      '#curp','input[name="curp"]','input[name="curpa"]','#curpa',
      'input[placeholder*="CURP"]','input[placeholder*="curp"]',
      'input[placeholder*="Ingresa tu CURP"]',
      'input[type="text"][maxlength="18"]',
    ];
    let inp = null;
    for (const sel of sels) { inp=document.querySelector(sel); if(inp) break; }
    if (!inp) throw new Error('no input found');
    setVal(inp, user.identificador.toUpperCase());
    await sleep(500);
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (!cb.checked) { click(cb); await sleep(100); }
    }
    const SUBMIT_TEXTS=['consultar','buscar','search','continuar','consulta tus'];
    let btn=null;
    for (let i=0; i<20; i++) {
      btn=Array.from(document.querySelectorAll(
        'button[type="submit"],input[type="submit"],button[type="button"],button:not([type])'
      )).find(b => {
        if(b.disabled) return false;
        return SUBMIT_TEXTS.some(kw=>(b.textContent||b.getAttribute('value')||'').toLowerCase().includes(kw));
      });
      if(btn) break; await sleep(300);
    }
    const autoClose=opts.autoClose!==false;
    let submitResolve;
    const submitted=new Promise(r=>{submitResolve=r;});
    if (btn) { click(btn); submitResolve(); banner('Consulta enviada automaticamente en '+name+'.','#15803D'); }
    else { banner('Datos prellenados en '+name+'. Haz clic en consultar.','#1E3A8A'); setTimeout(submitResolve,60000); }
    watchResults(id, name, autoClose, submitted);
  } catch(err) {
    banner('No se pudo prellenar '+name+'. Ingresa los datos manualmente.','#B91C1C');
  }
}

/* ═══════════════════════════════════════════════════════════
   PUNTO DE ENTRADA
   ═══════════════════════════════════════════════════════════ */
chrome.storage.local.get([K_USER, K_TS], async r => {
  const user = r[K_USER];
  const ts   = r[K_TS];
  if (!user || !user.identificador || !ts || (Date.now()-ts)>TTL) return;

  await sleep(2000);
  const pageError = detectPageError();
  if (pageError) {
    const id=location.hostname.replace(/[^a-z0-9]/gi,'_');
    saveResult(id, document.title.slice(0,50)||location.hostname, [], 'error', pageError, false);
    banner('Error en el portal: '+pageError, '#B91C1C');
    return;
  }

  const host = location.hostname;

  if      (host.includes('altanredes.com'))          await fillAltan(user);
  else if (host.includes('dalefon.mx'))               await fillDalefon(user);
  else if (host.includes('internetbienestarmex.com')) await fillDalefonBien(user);
  else if (host.includes('redphone.com.mx'))          await fillTurboRails(user,'redphone','Redphone');
  else if (host.includes('mimovil.com.mx'))           await fillTurboRails(user,'mi_movil','Mi Movil');
  else if (host.includes('mosi.mx'))                  await fillTurboRails(user,'mosi','Mosi');
  else if (host.includes('oxiomobile.com'))           await fillOxio(user);
  else if (host.includes('virginmobile.mx'))          await fillGenericAuto(user,'virgin','Virgin Mobile',{autoClose:false});
  else if (host.includes('btz.mx'))                   await fillGenericAuto(user,'bait','Bait',{autoClose:false});
  /* Las demás entradas en content_scripts.matches ya están cubiertas por las ramas específicas. */
});
