/*
  ╔══════════════════════════════════════════════════════════════╗
  ║   Clarity Club — Service Worker  v4.0                       ║
  ║   True offline background notifications                      ║
  ║   UPLOAD THIS FILE to the SAME OneDrive folder as the HTML  ║
  ╚══════════════════════════════════════════════════════════════╝
*/

const SW_VER   = 'cc-v4.0';
const CACHE_NM = 'cc-offline-v4';
const IDB_NM   = 'clarity_club';
const IDB_STORE= 'sw_data';
const IDB_KEY  = 'main';

// ── Install: cache the app HTML for offline ────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NM)
      .then(c => c.addAll(['./clarity-club-vibes.html']).catch(()=>{}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: take control + load saved data immediately ──────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE_NM).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => loadDataAndCheck())
  );
});

// ── IndexedDB helpers ─────────────────────────────────────────────
function openDB() {
  return new Promise((res,rej) => {
    const r = indexedDB.open(IDB_NM, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE, {keyPath:'id'});
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function saveData(data) {
  try {
    const db = await openDB();
    return new Promise((res,rej) => {
      const tx = db.transaction(IDB_STORE,'readwrite');
      tx.objectStore(IDB_STORE).put({id:IDB_KEY, ...data});
      tx.oncomplete = ()=>res(true);
      tx.onerror    = ()=>rej(tx.error);
    });
  } catch(e){}
}
async function loadData() {
  try {
    const db = await openDB();
    return new Promise(res => {
      const tx = db.transaction(IDB_STORE,'readonly');
      const rq = tx.objectStore(IDB_STORE).get(IDB_KEY);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror   = () => res(null);
    });
  } catch(e){ return null; }
}

// ── State ─────────────────────────────────────────────────────────
let _s = {
  reminders:[], alarms:[], schedule:{}, customCls:[],
  days:['SUN','MON','TUE','WED','THU','FRI','SAT'],
  fired:{}
};
let _timer = null;
let _lastMin = -1;

// ── Helpers ───────────────────────────────────────────────────────
const pad   = n => String(n).padStart(2,'0');
const toMin = t => { const [h,m]=(t||'0:0').split(':').map(Number); return h*60+m; };
function now() {
  const n=new Date();
  return {
    ts: pad(n.getHours())+':'+pad(n.getMinutes()),
    td: n.toISOString().slice(0,10),
    nm: n.getHours()*60+n.getMinutes(),
    dk: (_s.days||[])[n.getDay()]||''
  };
}

// ── Fire a system notification (plays phone default sound) ─────────
function fire(title, body, tag, vib, sticky) {
  return self.registration.showNotification(title, {
    body,
    vibrate:            vib   || [300,100,300,100,600],
    requireInteraction: sticky!==false,
    tag,
    renotify:  true,
    silent:    false,        // ← phone plays its own notification sound
  });
}

// ── Core: check all reminders / alarms / classes right now ────────
async function checkNow() {
  const {ts,td,nm,dk} = now();
  if (nm===_lastMin) return;
  _lastMin = nm;
  let dirty = false;

  // Reminders
  for (const r of _s.reminders) {
    const k='rem'+r.id+td;
    if (!_s.fired[k] && r.time===ts && (!r.date||r.date===td)) {
      _s.fired[k]=1; dirty=true;
      await fire('🔔 '+r.tit, r.note||'Reminder!', 'rem'+r.id, [300,100,300,100,600], true);
    }
  }

  // Alarms
  for (const a of _s.alarms) {
    const k='alm'+a.id+td+ts;
    if (a.on && !_s.fired[k] && a.time===ts) {
      _s.fired[k]=1; dirty=true;
      await fire('⏰ '+a.lbl, 'Alarm · '+ts, 'alm'+a.id, [400,100,400,100,800,100,800], true);
    }
  }

  // Classes
  const slots=[
    ...(_s.schedule[dk]||[]),
    ...(_s.customCls||[]).filter(c=>c.day===dk)
  ].filter(s=>s.t!=='recess');

  for (const s of slots) {
    const sm=toMin(s.s);
    if (nm===sm-5) {
      const k='c5'+s.s+td;
      if (!_s.fired[k]) {
        _s.fired[k]=1; dirty=true;
        await fire('⏰ '+s.sub+' in 5 min','Class at '+s.s+' · Hall F-4','cls5'+s.s,[200,80,200,80,200],false);
      }
    }
    if (nm===sm) {
      const k='c0'+s.s+td;
      if (!_s.fired[k]) {
        _s.fired[k]=1; dirty=true;
        await fire('🏛️ '+s.sub+' — Now',(s.tea&&s.tea!=='Batch'?s.tea+' · ':'')+'Hall F-4','cls'+s.s,[300,100,300,100,600],true);
      }
    }
  }

  // Prune old fired log (older than 2 days)
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-2);
  const cut=cutoff.toISOString().slice(0,10).replace(/-/g,'');
  for (const k of Object.keys(_s.fired)) {
    const m=k.match(/(\d{4}\d{2}\d{2})/);
    if (m && m[1]<cut) delete _s.fired[k];
  }

  if (dirty) await saveData(_s);
}

// ── Schedule next check at the next exact minute ──────────────────
function schedNext() {
  if (_timer) clearTimeout(_timer);
  const n=new Date();
  const ms=60000-n.getSeconds()*1000-n.getMilliseconds()+200;
  _timer=setTimeout(async()=>{ await checkNow(); schedNext(); }, ms);
}

// ── Load from IndexedDB and start the clock ───────────────────────
async function loadDataAndCheck() {
  const saved = await loadData();
  if (saved) {
    _s = {
      reminders: saved.reminders||[],
      alarms:    saved.alarms   ||[],
      schedule:  saved.schedule ||{},
      days:      saved.days     ||_s.days,
      customCls: saved.customCls||[],
      fired:     saved.fired    ||{},
    };
  }
  await checkNow();
  schedNext();
}

// ── Message from the app page ─────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type==='SYNC') {
    _s = {
      reminders: e.data.reminders||[],
      alarms:    e.data.alarms   ||[],
      schedule:  e.data.schedule ||{},
      days:      e.data.days     ||_s.days,
      customCls: e.data.customCls||[],
      fired:     _s.fired        ||{},
    };
    saveData(_s);
    schedNext();
    if (e.source) e.source.postMessage({type:'SYNC_ACK',ver:SW_VER});
  }
  if (e.data.type==='PING') {
    if (e.source) e.source.postMessage({type:'PONG',ver:SW_VER});
  }
  if (e.data.type==='CHECK_NOW') {
    checkNow();
  }
});

// ── Fetch: serve cached HTML when offline ─────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method!=='GET') return;
  if (e.request.mode==='navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          caches.open(CACHE_NM).then(c=>c.put(e.request,res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>c)));
});

// ── Notification tap: open / focus the app ────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
      for (const c of cs) if ('focus' in c) return c.focus();
      return clients.openWindow('.');
    })
  );
});

// ── Background Sync (fires when network restored) ──────────────────
self.addEventListener('sync', e => {
  if (e.tag==='cc-check') e.waitUntil(loadDataAndCheck());
});

// ── Periodic Background Sync (Chrome 80+, fires hourly when closed) ─
self.addEventListener('periodicsync', e => {
  if (e.tag==='cc-periodic') e.waitUntil(loadDataAndCheck());
});

// Start the clock immediately
loadDataAndCheck();
