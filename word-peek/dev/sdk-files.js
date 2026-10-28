const PREFIX = '/word-peek-grants/'
const LIMIT = 900000

export function fileAddress(folder, path) {
  const segments = String(path).split('/')
  if (!folder || /[/\\:\0]/.test(folder) || !segments.length || segments.some(s => !s || s === '.' || s === '..' || /[\\:\0]/.test(s))) throw new Error('Invalid document path.')
  return PREFIX + encodeURIComponent(folder) + '/' + segments.map(encodeURIComponent).join('/')
}
export function fileUrl(folder, path) { return 'file://' + fileAddress(folder, path) }
export function parseAddress(address) {
  // localHtmlPath decodes URL escapes. SDK handles still determine access.
  if (!String(address).startsWith(PREFIX)) throw new Error('Open this document through Word Peek first.')
  const parts = String(address).slice(PREFIX.length).split('/')
  const folder = parts.shift()
  if (!folder || /[\\:\0]/.test(folder) || !parts.length || parts.some(s => !s || s === '.' || s === '..' || /[\\:\0]/.test(s))) throw new Error('Invalid document path.')
  return {folder, path:parts.join('/')}
}
function unwrap(result) {
  if (!result?.ok) throw new Error(result?.message || result?.error || 'File access was refused.')
  return result
}
export function createFileAdapter(files) {
  return {
    async readHtml(address) {
      if (!files?.readText) throw new Error('Update Hermes Desktop to use folder-scoped file access.')
      const {folder,path} = parseAddress(address)
      const result = unwrap(await files.readText(folder,path))
      if (typeof result.text !== 'string' || result.text.length > LIMIT) throw new Error('The HTML file exceeds the 900,000 character limit.')
      return result.text
    },
    async writeHtml(address,text,options) {
      if (!files?.writeText) throw new Error('Update Hermes Desktop to use folder-scoped file access.')
      if (typeof text !== 'string' || text.length > LIMIT) throw new Error('The HTML file exceeds the 900,000 character limit.')
      const {folder,path} = parseAddress(address)
      unwrap(await files.writeText(folder,path,text,options))
    }
  }
}
