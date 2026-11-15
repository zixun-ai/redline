// Read the real browser store; fixtures use the same transaction boundary as the editor.
export async function stored(page, key) {
  await page.locator('.save-state').filter({ hasNotText: '正在保存' }).waitFor();
  return page.evaluate(key => new Promise((resolve, reject) => {
    const open = indexedDB.open('redline', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor', 'readonly');
      const request = tx.objectStore('editor').get(key.replace(/^redline\.|\.v1$/g, ''));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), key);
}

export async function seed(page, values) {
  await page.locator('.save-state').filter({ hasNotText: '正在保存' }).waitFor();
  return page.evaluate(values => new Promise((resolve, reject) => {
    const open = indexedDB.open('redline', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('editor', 'readwrite'), store = tx.objectStore('editor');
      for (const [key, value] of Object.entries(values)) value === undefined ? store.delete(key) : store.put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), values);
}

export async function reload(page) {
  await page.locator('.save-state').filter({ hasNotText: '正在保存' }).waitFor();
  await page.reload();
  await page.locator('.app').waitFor();
}
