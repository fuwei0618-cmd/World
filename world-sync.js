/* World 的 OneDrive 同步：行程、筆記、朋友（IndexedDB）＋ 打包清單等設定
 * 照片／錄音／影片另外存成檔案（OneDrive 應用程式資料夾 /origina-world/），筆記裡只記檔名。
 * 金鑰類（GitHub token、Whisper key、團隊密碼）不上傳。 */
(function () {
  const DB = window.WorldDB;
  if (!DB || !window.OriginaSync) return;
  const SYNC_LS = k => /^world:(pack:|niche$)/.test(k);
  const UP = "world-sync-up";
  const up = () => { try { return JSON.parse(localStorage.getItem(UP) || "{}"); } catch (e) { return {}; } };
  const markUp = k => { const o = up(); o[k] = 1; localStorage.setItem(UP, JSON.stringify(o)); };
  const ready = async () => { for (let i = 0; i < 100 && !DB.db; i++) await new Promise(r => setTimeout(r, 100)); if (!DB.db) throw new Error("db"); };
  const all = store => DB.req(store, "readonly", s => s.getAll());
  const keyOf = (n, m, i) => m.ref || (n.id + "-" + i + "-" + ((m.blob && m.blob.size) || 0) + "." + String(m.type || m.kind || "bin").split("/").pop().replace(/[^a-z0-9]/gi, ""));

  const adapter = {
    async export(api) {
      await ready();
      const [trips, notes, friends] = await Promise.all([all("trips"), all("notes"), all("friends")]);
      const done = up(), outNotes = [];
      for (const n of notes) {
        const media = [];
        for (const [i, m] of (n.media || []).entries()) {
          const ref = keyOf(n, m, i);
          if (!done[ref] && m.blob && m.blob.size) { await api.putBlob("origina-world/" + ref, m.blob); markUp(ref); }
          const { blob, ...rest } = m; media.push({ ...rest, ref });
        }
        outNotes.push({ ...n, media });
      }
      const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (SYNC_LS(k)) ls[k] = localStorage.getItem(k); }
      return { trips, notes: outNotes, friends, ls };
    },
    async import(d, api) {
      await ready();
      const local = await all("notes"), have = {};
      local.forEach(n => (n.media || []).forEach((m, i) => { if (m.blob && m.blob.size) have[keyOf(n, m, i)] = m.blob; }));
      const notes = [];
      for (const n of d.notes || []) {
        const media = [];
        for (const m of n.media || []) {
          let blob = have[m.ref];
          if (!blob) { try { blob = await api.getBlob("origina-world/" + m.ref); } catch (e) { blob = null; } if (blob) markUp(m.ref); }
          media.push({ ...m, blob: blob ? (blob.type ? blob : new Blob([blob], { type: m.type || "" })) : new Blob([], { type: m.type || "" }) });
        }
        notes.push({ ...n, media });
      }
      await DB.req("trips", "readwrite", s => { s.clear(); (d.trips || []).forEach(t => s.put(t)); });
      await DB.req("notes", "readwrite", s => { s.clear(); notes.forEach(n => s.put(n)); });
      await DB.req("friends", "readwrite", s => { s.clear(); (d.friends || []).forEach(f => s.put(f)); });
      Object.entries(d.ls || {}).forEach(([k, v]) => { if (SYNC_LS(k)) localStorage.setItem(k, v); });
      return "reload";
    },
    watch(cb) {
      ["putTrip", "delTrip", "putNote", "delNote", "putFriend", "delFriend"].forEach(fn => {
        const o = DB[fn]; DB[fn] = function () { const r = o.apply(this, arguments); Promise.resolve(r).then(cb, () => {}); return r; };
      });
      OriginaSync.onStorage(k => { if (SYNC_LS(k)) cb(); });
    }
  };
  OriginaSync.init({ app: "world", adapter, pos: "br", offset: 84 });
})();
