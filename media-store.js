/**
 * Медиа: при работе через HTTP(S) файлы уходят на сервер (/api/upload → /uploads/...).
 * Без сервера (file://) — IndexedDB, ссылки local:<id>.
 */
(function (global) {
  const DB_NAME = 'apsny_guide_media_v1';
  const STORE = 'blobs';
  const urlCache = new Map();

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
    });
  }

  function isLocalRef(ref) {
    return typeof ref === 'string' && ref.startsWith('local:');
  }

  function parseLocalId(ref) {
    return ref.slice(6);
  }

  async function saveFileToIndexedDB(file) {
    const id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return 'local:' + id;
  }

  async function saveFile(file) {
    if (
      typeof location !== 'undefined' &&
      (location.protocol === 'http:' || location.protocol === 'https:')
    ) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        if (res.ok) {
          const j = await res.json();
          if (j && j.url) return j.url;
        }
      } catch (e) {
        console.warn('[ApsnyMedia] Сервер недоступен, сохраняем офлайн:', e);
      }
    }
    return saveFileToIndexedDB(file);
  }

  async function deleteBlob(refOrId) {
    const id = isLocalRef(refOrId) ? parseLocalId(refOrId) : String(refOrId);
    const cached = urlCache.get(id);
    if (cached) {
      URL.revokeObjectURL(cached);
      urlCache.delete(id);
    }
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getBlobUrl(ref) {
    if (!ref) return '';
    if (!isLocalRef(ref)) return ref;
    const id = parseLocalId(ref);
    if (urlCache.has(id)) return urlCache.get(id);
    const db = await openDb();
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }

  function guessIsVideoFromUrl(src) {
    if (!src || isLocalRef(src)) return false;
    const s = String(src).toLowerCase();
    return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(s);
  }

  function guessIsVideo(fileOrNull, url) {
    if (fileOrNull && fileOrNull.type) return fileOrNull.type.startsWith('video/');
    return guessIsVideoFromUrl(url || '');
  }

  function collectRefsFromTour(tour) {
    const refs = [];
    if (!tour) return refs;
    if (isLocalRef(tour.mainMedia)) refs.push(tour.mainMedia);
    (tour.attractions || []).forEach((a) => {
      if (isLocalRef(a.media)) refs.push(a.media);
    });
    return refs;
  }

  function hotelGallery(h) {
    if (h.gallery && h.gallery.length) return h.gallery;
    if (h.images && h.images.length) {
      return h.images.map((media) => ({ media, isVideo: guessIsVideoFromUrl(media) }));
    }
    return [];
  }

  function collectRefsFromHotel(h) {
    const refs = [];
    hotelGallery(h).forEach((it) => {
      if (isLocalRef(it.media)) refs.push(it.media);
    });
    return refs;
  }

  async function deleteRefs(refs) {
    const unique = [...new Set(refs)];
    for (const r of unique) {
      try {
        await deleteBlob(r);
      } catch (_) {}
    }
  }

  global.ApsnyMedia = {
    isLocalRef,
    saveFile,
    deleteBlob,
    getBlobUrl,
    guessIsVideo,
    guessIsVideoFromUrl,
    collectRefsFromTour,
    collectRefsFromHotel,
    hotelGallery,
    deleteRefs,
  };
})(typeof window !== 'undefined' ? window : self);
