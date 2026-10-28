import {capturePassage} from './html-edit.js'
import {fileAddress,fileUrl,createFileAdapter} from './sdk-files.js'
import {parse,serialize} from 'parse5'

const POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; form-action 'none'; base-uri 'none'"
export function readerHtml(source) {
  const doc = parse(source)
  const html = doc.childNodes.find(n=>n.tagName==='html')
  const head = html.childNodes.find(n=>n.tagName==='head')
  function prune(node) {
    if (!node.childNodes) return
    // Preserve element positions so passage paths still match the original source.
    if(node.tagName==='base')node.attrs=node.attrs.filter(a=>!['href','target'].includes(a.name))
    if(node.tagName==='meta' && node.attrs?.some(a=>a.name==='http-equiv' && a.value.toLowerCase()==='refresh'))node.attrs=node.attrs.filter(a=>!['http-equiv','content'].includes(a.name))
    node.childNodes.forEach(prune)
  }
  prune(doc)
  // Use a parsed meta node: no raw markup is ever evaluated in the app document.
  const metaDoc = parse('<meta http-equiv="Content-Security-Policy">')
  const meta = metaDoc.childNodes.find(n=>n.tagName==='html').childNodes.find(n=>n.tagName==='head').childNodes[0]
  meta.attrs.push({name:'content',value:POLICY}); meta.parentNode=head
  head.childNodes.unshift(meta)
  return serialize(doc)
}
function element(tag,text) { const e=document.createElement(tag); if(text) e.textContent=text; return e }
export function createReader(ctx,onSelection) {
  const files=ctx.files
  const adapter=createFileAdapter(files)
  let dialog=null, frame=null, currentAddress=null, generation=0, disposed=false
  function close() { generation++; dialog?.remove(); dialog=null; frame=null; currentAddress=null }
  function shell() {
    close()
    dialog=element('section'); dialog.id='word-peek-reader'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-label','Word Peek document')
    Object.assign(dialog.style,{position:'fixed',inset:'32px',zIndex:'2147483645',background:'#20242c',color:'#edf0f6',border:'1px solid #495261',borderRadius:'12px',padding:'16px',display:'flex',flexDirection:'column',gap:'12px',font:'14px system-ui'})
    const bar=element('div'); bar.style.display='flex'; bar.style.gap='12px'
    const title=element('strong','Word Peek'); title.style.flex='1'
    const dismiss=element('button','Close'); dismiss.onclick=close
    bar.append(title,dismiss); dialog.append(bar)
    const hint=element('div','Choose an HTML file, then select text and right-click. Scripts and external resources are disabled in this reader.')
    dialog.append(hint); document.body.append(dialog)
    return {title,hint}
  }
  async function display(folder,path) {
    if(disposed)return
    const {title,hint}=shell(); const token=generation
    currentAddress=fileUrl(folder,path)
    title.textContent=path
    const source=await adapter.readHtml(decodeURIComponent(fileAddress(folder,path)))
    if(token!==generation)return
    frame=element('iframe'); frame.title=path; frame.setAttribute('sandbox','allow-same-origin')
    Object.assign(frame.style,{flex:'1',minHeight:'0',width:'100%',background:'white',border:'0'})
    const ownFrame=frame
    ownFrame.addEventListener('load',()=>{
      if(token!==generation)return
      ownFrame.contentDocument.addEventListener('click',ev=>{if(ev.target.closest?.('a'))ev.preventDefault()},true)
      ownFrame.contentDocument.addEventListener('contextmenu',ev=>{
        const selection=String(ownFrame.contentWindow.getSelection()||'').trim()
        if(!selection)return
        ev.preventDefault();ev.stopPropagation()
        try {
          const passage=capturePassage(ownFrame.contentWindow); passage.url=fileUrl(folder,path)
          const explicitUrls=new Set(Array.from(ownFrame.contentDocument.querySelectorAll('a[href]')).filter(a=>/^https?:\/\//i.test(a.getAttribute('href'))).map(a=>a.href))
          passage.sources=passage.sources.filter(source=>explicitUrls.has(source.url))
          const rect=ownFrame.getBoundingClientRect()
          onSelection(passage,{get isConnected(){return currentAddress===fileUrl(folder,path)&&Boolean(frame?.isConnected)},getURL:()=>fileUrl(folder,path),reload:()=>display(folder,path)},rect.left+ev.clientX,rect.top+ev.clientY)
        } catch(error) { hint.textContent=error.message }
      },true)
    })
    ownFrame.srcdoc=readerHtml(source); dialog.append(ownFrame)
  }
  async function browse(folder,path='') {
    if(disposed)return
    const {title,hint}=shell(); const token=generation
    title.textContent='Open HTML - '+(path||folder.name)
    const result=await files.list(folder.id,path)
    if(token!==generation)return
    if(!result?.ok)throw new Error(result?.message||'Cannot list this folder.')
    const list=element('div');Object.assign(list.style,{overflow:'auto',display:'flex',flexDirection:'column',gap:'6px'})
    if(path) {const up=element('button','Parent folder');up.onclick=()=>browse(folder,path.split('/').slice(0,-1).join('/')).catch(e=>hint.textContent=e.message);list.append(up)}
    for(const entry of result.entries.filter(e=>e.isDirectory||/\.html?$/i.test(e.name))) {
      const button=element('button',entry.isDirectory?'Folder: '+entry.name:entry.name)
      button.onclick=()=> (entry.isDirectory?browse(folder,entry.path):display(folder.id,entry.path)).catch(e=>hint.textContent=e.message)
      list.append(button)
    }
    if(!list.childNodes.length)list.append(element('p','No HTML files in this folder.'))
    if(result.truncated)list.append(element('p','This folder listing is truncated. Choose a smaller folder.'))
    dialog.append(list)
  }
  async function open() {
    if(disposed)return
    const token=generation
    if(!files?.requestFolder)throw new Error('Folder access is unavailable in this Hermes build.')
    const folders=await files.folders()
    if(disposed||token!==generation)return
    if(folders.length) {
      const {hint}=shell()
      for(const folder of folders) {const button=element('button',folder.name);button.onclick=()=>browse(folder).catch(e=>hint.textContent=e.message);dialog.append(button)}
      const choose=element('button','Choose another folder');choose.onclick=()=>grant().catch(e=>hint.textContent=e.message);dialog.append(choose)
    } else await grant()
  }
  async function grant() {
    if(disposed)return
    const token=generation
    const result=await files.requestFolder()
    if(disposed||token!==generation)return
    if(!result?.ok)throw new Error(result?.message||'Folder access was refused.')
    if(result.folder)await browse(result.folder)
  }
  return {open,close,adapter,dispose(){disposed=true;close()}}
}
