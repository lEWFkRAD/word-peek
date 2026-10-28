import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHtmlFileTransactions} from './html-files.js'
const PATH='/word-peek-grants/test/doc.html', BEFORE='<html><body>before</body></html>', AFTER='<html><body>after</body></html>'
function harness(hooks={}) {
  const files=new Map([[PATH,BEFORE]]),records=new Map(),writes=[]
  const storage={get:(k,d)=>records.has(k)?records.get(k):d,set:(k,v)=>{if(!hooks.storageBlocked)records.set(k,structuredClone(v))},remove:k=>records.delete(k)}
  const editor=createHtmlFileTransactions({storage,
    readHtml:async p=>{await hooks.onRead?.(p,files,records);return files.get(p)},
    writeHtml:async(p,t,options)=>{writes.push({path:p,text:t,options});if(options?.exclusive&&files.has(p))throw new Error('exists');files.set(p,t);await hooks.onWrite?.(p,t,files,records)}
  })
  return {files,records,writes,editor}
}
const save=(h,signal)=>h.editor.save({path:PATH,before:BEFORE,after:AFTER,signal})
test('verified exclusive backup, save and Undo round trip',async()=>{
  const h=harness(),record=await save(h)
  assert.equal(h.files.get(PATH),AFTER);assert.equal(h.files.get(record.backup),BEFORE)
  assert.equal(h.writes[0].options.exclusive,true);assert.equal(h.records.has('html.pending.v1'),false)
  await h.editor.undo(PATH);assert.equal(h.files.get(PATH),BEFORE);assert.equal(h.editor.lastUndo(PATH),null)
})
test('concurrent external change during backup is preserved',async()=>{
  const h=harness({onWrite:(p,_t,files)=>{if(p.endsWith('.bak'))files.set(PATH,'external edit')}})
  await assert.rejects(save(h),/changed while preparing/)
  assert.equal(h.files.get(PATH),'external edit');assert.equal(h.writes.filter(w=>w.path===PATH).length,0)
  assert.equal(h.records.has('html.pending.v1'),false)
})
test('cancellation during backup prevents original mutation',async()=>{
  const c=new AbortController(),h=harness({onRead:p=>{if(p.endsWith('.bak'))c.abort()}})
  await assert.rejects(save(h,c.signal),{name:'AbortError'})
  assert.equal(h.files.get(PATH),BEFORE);assert.equal(h.writes.filter(w=>w.path===PATH).length,0)
})
test('save and Undo serialize while a backup is pending',async()=>{
  let release,started;const blocked=new Promise(r=>release=r),ready=new Promise(r=>started=r)
  const h=harness({onWrite:async p=>{if(p.endsWith('.bak')){started();await blocked}}})
  const first=save(h);await ready
  await assert.rejects(save(h),/in progress/);await assert.rejects(h.editor.undo(PATH),/in progress/)
  release();await first;assert.equal(h.files.get(PATH),AFTER)
})
test('uncertain write retains pending recovery and backup',async()=>{
  const h=harness({onWrite:p=>{if(p===PATH)throw new Error('bridge disconnected')}})
  await assert.rejects(save(h),/Original backup:/)
  const pending=h.records.get('html.pending.v1');assert.ok(pending);assert.equal(h.files.get(pending.backup),BEFORE)
  await assert.rejects(h.editor.save({path:PATH,before:AFTER,after:BEFORE}),/needs recovery/)
})
test('failed post-write verification does not publish successful Undo',async()=>{
  const h=harness({onWrite:(p,_t,files)=>{if(p===PATH)files.set(PATH,'partial write')}})
  await assert.rejects(save(h),/Could not verify/)
  assert.equal(h.records.has('html.undo.v1'),false);assert.equal(h.records.has('html.pending.v1'),true)
})
test('storage failure prevents original mutation',async()=>{
  const h=harness({storageBlocked:true});await assert.rejects(save(h),/room to save Undo/)
  assert.equal(h.files.get(PATH),BEFORE);assert.equal(h.writes.filter(w=>w.path===PATH).length,0)
})
test('Undo refuses external work appearing during backup read',async()=>{
  let undoing=false
  const h=harness({onRead:(p,files)=>{if(undoing&&p.endsWith('.bak'))files.set(PATH,'new user work')}})
  await save(h);undoing=true;await assert.rejects(h.editor.undo(PATH),/changed while preparing Undo/)
  assert.equal(h.files.get(PATH),'new user work');assert.ok(h.editor.lastUndo(PATH))
})
test('cancel after write starts retains verified Undo',async()=>{
  const c=new AbortController(),h=harness({onWrite:p=>{if(p===PATH)c.abort()}})
  await save(h,c.signal);assert.equal(h.files.get(PATH),AFTER);assert.ok(h.records.get('html.undo.v1'))
})
test('successive saves never reuse backup paths',async()=>{
  const h=harness(),first=await save(h)
  const second=await h.editor.save({path:PATH,before:AFTER,after:BEFORE})
  assert.notEqual(first.backup,second.backup);assert.equal(h.files.get(first.backup),BEFORE);assert.equal(h.files.get(second.backup),AFTER)
})
