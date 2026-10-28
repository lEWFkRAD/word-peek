const MAX_HTML = 900000
function abortError() { const e = new Error('Request cancelled.'); e.name = 'AbortError'; return e }
function checkAbort(signal) { if (signal?.aborted) throw abortError() }
async function digest(text) {
  if (!globalThis.crypto?.subtle) throw new Error('This desktop context cannot verify local file edits.')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
function sameRecord(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
export function createHtmlFileTransactions({ readHtml, writeHtml, storage }) {
  let busy = false
  const read = async path => {
    const text = await readHtml(path)
    if (typeof text !== 'string') throw new Error('The HTML file could not be read in full.')
    return text
  }
  const persist = (key, record) => {
    storage?.set(key, record)
    if (!sameRecord(storage?.get(key, null), record)) throw new Error('There is no room to save Undo information. Free some application storage before editing this file.')
  }
  const removeOwned = (key, record) => {
    if (sameRecord(storage?.get(key, null), record)) storage.remove(key)
  }
  const lastUndo = path => {
    const pending = storage?.get('html.pending.v1', null)
    if (pending?.path === path) return pending
    const record = storage?.get('html.undo.v1', null)
    return record?.path === path ? record : null
  }
  return {
    get busy() { return busy },
    lastUndo,
    async save({ path, before, after, signal }) {
      if (busy) throw new Error('Another HTML save or Undo is in progress. Try again when it finishes.')
      busy = true
      let touched = false, record
      try {
        checkAbort(signal)
        if (typeof before !== 'string' || typeof after !== 'string') throw new Error('The HTML edit is incomplete.')
        if (after.length > MAX_HTML) throw new Error('The updated HTML exceeds the desktop write limit.')
        const pending = storage?.get('html.pending.v1', null)
        if (pending) throw new Error('A previous HTML save needs recovery. Open that file and use Undo; its original backup is ' + pending.backup)
        if (await read(path) !== before) throw new Error('The HTML changed since this edit was prepared. Preview the change again before applying.')
        checkAbort(signal)
        const beforeHash = await digest(before), afterHash = await digest(after)
        checkAbort(signal)
        const nonce = crypto.randomUUID()
        const backup = path + '.word-peek-' + nonce + '.bak'
        await writeHtml(backup, before, { exclusive: true })
        if (await digest(await read(backup)) !== beforeHash) throw new Error('The backup could not be verified. The original has not been edited.')
        checkAbort(signal)
        record = { path, backup, beforeHash, afterHash }
        persist('html.pending.v1', record)
        if (await read(path) !== before) throw new Error('The file changed while preparing the backup. Nothing was applied.')
        checkAbort(signal)
        touched = true
        await writeHtml(path, after)
        if (await read(path) !== after) throw new Error('Could not verify the saved file.')
        persist('html.undo.v1', record)
        removeOwned('html.pending.v1', record)
        return record
      } catch (error) {
        if (touched && record) error.message += '\nOriginal backup: ' + record.backup
        throw error
      } finally {
        try { if (!touched && record) removeOwned('html.pending.v1', record) }
        finally { busy = false }
      }
    },
    async undo(path) {
      if (busy) throw new Error('Another HTML save or Undo is in progress. Try again when it finishes.')
      busy = true
      try {
        const record = lastUndo(path)
        if (!record) throw new Error('No saved change to undo for this file.')
        const current = await read(record.path), currentHash = await digest(current)
        if (currentHash !== record.afterHash && currentHash !== record.beforeHash) throw new Error('The HTML changed after that save. Undo would overwrite newer work; the original backup is ' + record.backup)
        const original = await read(record.backup)
        if (await digest(original) !== record.beforeHash) throw new Error('The backup changed. Undo has been stopped.')
        if (await read(record.path) !== current) throw new Error('The HTML changed while preparing Undo. No file was overwritten.')
        if (currentHash !== record.beforeHash) await writeHtml(record.path, original)
        if (await read(record.path) !== original) throw new Error('Could not verify Undo. Your backup is ' + record.backup)
        removeOwned('html.undo.v1', record)
        removeOwned('html.pending.v1', record)
        return record
      } finally { busy = false }
    }
  }
}
