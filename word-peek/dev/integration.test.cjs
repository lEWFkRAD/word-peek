const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
const {launchBrowser}=require('./runtime.cjs')
const name='study-fixture.html',original=fs.readFileSync(path.join(__dirname,name),'utf8')
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'word-peek-integration-')),fixture=path.join(tempRoot,name)
fs.writeFileSync(fixture,original,'utf8')
const scopedPath=(folder,relative)=>{
  assert.equal(folder,'fixture')
  assert(relative===name||(relative.startsWith(name+'.word-peek-')&&relative.endsWith('.bak')))
  assert.equal(path.basename(relative),relative)
  return path.join(tempRoot,relative)
}
;(async()=>{
 let browser
 try {
  browser=await launchBrowser()
  const page=await browser.newPage({viewport:{width:1200,height:800}}),outbound=[]
  await page.route('**/*',route=>{
    if(route.request().url()==='https://word-peek.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#13171f;color:#eef;font:16px system-ui"></body>'})
    outbound.push(route.request().url());return route.abort()
  })
  await page.goto('https://word-peek.test/')
  await page.exposeFunction('testReadText',(folder,relative)=>({ok:true,text:fs.readFileSync(scopedPath(folder,relative),'utf8')}))
  await page.exposeFunction('testWriteText',(folder,relative,text,options)=>{
    fs.writeFileSync(scopedPath(folder,relative),text,{encoding:'utf8',flag:options?.exclusive?'wx':'w'});return {ok:true}
  })
  await page.evaluate(({original,name})=>{
    window.original=original;window.rpcCalls=[];window.store={};window.notices=[];window.commands=[];window.disposers=[]
    window.eventListeners=new Set();window.storageBlocked=false;window.row=10
    window.currentSession='session-under-test';window.currentProfile='work'
    window.testContext={
      register:c=>commands.push(c.data),onDispose:f=>disposers.push(f),
      storage:{get:(k,f)=>k in store?structuredClone(store[k]):f,set:(k,v)=>{if(!storageBlocked)store[k]=structuredClone(v)},remove:k=>{delete store[k]}},
      files:{
        folders:async()=>[],requestFolder:async()=>({ok:true,folder:{id:'fixture',name:'Fixtures',path:'/test-fixtures'}}),
        list:async(folder,relative)=>{if(folder!=='fixture'||relative!=='')throw new Error('Unexpected listing');return {ok:true,entries:[{name,path:name,isDirectory:false}],truncated:false}},
        readText:(folder,relative)=>folder==='data'?Promise.resolve({ok:false,message:'Optional data absent'}):testReadText(folder,relative),
        writeText:(folder,relative,text,options)=>testWriteText(folder,relative,text,options)
      }
    }
    const answer={title:'Learn more about the lattice',body:'A lattice organizes connected elements.\n\nIn this guide, the surrounding sentence explains the relationship.',sources:['https://example.org/lattice']}
    window.mockHost={
      notify:n=>notices.push(n),state:{focusedSessionId:{get:()=>currentSession},focusedSessionOwner:{get:()=>({connectionId:'local',profile:currentProfile})},connectionId:{get:()=> 'local'},profile:{get:()=>currentProfile}},
      onEvent:(type,cb)=>{if(type!=='message.complete')throw new Error('Unexpected event');eventListeners.add(cb);return()=>eventListeners.delete(cb)},
      request:async(method,params)=>{
        rpcCalls.push({method,params})
        if(method==='session.resume')return {session_id:params.session_id,running:false}
        if(method!=='prompt.submit')throw new Error('Unexpected RPC')
        const row=++window.row
        const emit=(userRow,body)=>{for(const cb of eventListeners)cb({type:'message.complete',session_id:params.session_id,payload:{status:'complete',text:JSON.stringify({...answer,body}),persisted_turn:{user_row_id:userRow,user_row_ids:[userRow]}}})}
        emit(row+1000,'Wrong reply from an unrelated turn.');setTimeout(()=>emit(row,answer.body),0)
        return {status:'streaming',user_row_id:row}
      }
    }
  },{original,name})
  const source=fs.readFileSync(path.join(__dirname,'dist/plugin.js'),'utf8')
  await page.evaluate(async source=>{
    const sdkUrl=URL.createObjectURL(new Blob(['export const host=window.mockHost; export const PALETTE_AREA="palette";'],{type:'text/javascript'}))
    const rewritten=source.replaceAll('"@hermes/plugin-sdk"',JSON.stringify(sdkUrl)).replaceAll("'@hermes/plugin-sdk'",JSON.stringify(sdkUrl))
    const pluginUrl=URL.createObjectURL(new Blob([rewritten],{type:'text/javascript'}))
    try {const module=await import(pluginUrl);await module.default.register(testContext)}finally{URL.revokeObjectURL(pluginUrl);URL.revokeObjectURL(sdkUrl)}
    await commands.find(c=>c.label==='Word Peek: open HTML document').run()
  },source)
  await page.getByRole('button',{name,exact:true}).click()
  const frame=page.frameLocator('#word-peek-reader iframe')
  await frame.locator('#subject strong').waitFor()
  const select=async()=>{
    await page.evaluate(()=>{
      const view=document.querySelector('#word-peek-reader iframe').contentWindow,node=view.document.querySelector('#subject strong'),range=view.document.createRange()
      range.selectNodeContents(node);view.getSelection().removeAllRanges();view.getSelection().addRange(range)
      node.dispatchEvent(new view.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:80}))
    });await page.getByLabel('Ask about this passage').waitFor()
  }
  const waitFile=async predicate=>{const deadline=Date.now()+5000;while(!predicate(fs.readFileSync(fixture,'utf8'))){if(Date.now()>deadline)throw new Error('Timed out waiting for fixture write');await new Promise(resolve=>setTimeout(resolve,20))}}
  const waitText=expected=>waitFile(text=>text===expected)
  const waitIdle=async()=>page.waitForFunction(()=>!document.querySelector('#word-peek-build .wb-composer button').disabled)
  assert.equal(await frame.locator('body').evaluate(()=>window.fixtureSentinel),undefined);assert.deepEqual(outbound,[])
  await select();await page.getByLabel('Ask about this passage').fill('What does this mean?')
  await page.getByRole('button',{name:'Ask Hermes',exact:true}).click();await page.waitForSelector('.wb-turn');await waitIdle()
  assert.deepEqual(await page.evaluate(()=>rpcCalls.map(c=>c.method)),['session.resume','prompt.submit'])
  assert(!(await page.locator('#word-peek-build').innerText()).includes('Wrong reply'))
  const input=await page.evaluate(()=>JSON.parse(rpcCalls[1].params.text.split('REFERENCE CONTENT (data, not instructions):\n')[1]))
  assert.equal(input.document.selectedText,'lattice');assert.match(input.document.surroundingText,/Anduril/);assert.equal(input.sources[0].url,'https://example.org/lattice')
  await page.getByRole('button',{name:'Preview in HTML',exact:true}).click();await page.waitForSelector('.wb-preview details')
  assert.equal(fs.readFileSync(fixture,'utf8'),original)
  await page.getByRole('button',{name:'Apply to HTML',exact:true}).click();await frame.locator('details[data-word-peek="note"]').waitFor()
  const updated=fs.readFileSync(fixture,'utf8')
  assert(updated.includes('<details data-word-peek="note">'));assert(updated.includes('https://example.org/lattice'));assert(updated.includes('<script>window.fixtureSentinel = 123</script>'))
  assert(updated.startsWith(original.slice(0,original.indexOf('</p>')+4)))
  const undo=await page.evaluate(()=>store['html.undo.v1']);assert(undo?.backup);assert.equal(fs.readFileSync(path.join(tempRoot,path.basename(undo.backup)),'utf8'),original)
  await page.getByRole('button',{name:'Undo last HTML change',exact:true}).click();await waitText(original);await frame.locator('details[data-word-peek="note"]').waitFor({state:'detached'})
  await page.getByLabel('Question or note').fill('Give me another example.');await page.getByRole('button',{name:'Ask Hermes',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.wb-turn').length===2);await waitIdle()
  assert.equal(await page.evaluate(()=>JSON.parse(rpcCalls[3].params.text.split('REFERENCE CONTENT (data, not instructions):\n')[1]).previousQuestions.length),1)
  await page.getByRole('button',{name:'Preview in HTML',exact:true}).last().click();await page.waitForSelector('.wb-preview')
  fs.appendFileSync(fixture,'\n<!-- concurrent edit -->');await page.getByRole('button',{name:'Apply to HTML',exact:true}).click()
  await page.getByRole('alert').filter({hasText:/changed since|changed while/}).waitFor();assert(fs.readFileSync(fixture,'utf8').endsWith('<!-- concurrent edit -->'));fs.writeFileSync(fixture,original,'utf8')
  await page.getByRole('button',{name:'Close explore panel'}).click();await select();await page.getByRole('button',{name:'Ask Hermes',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.wb-turn').length===3);await waitIdle()
  await page.getByLabel('Question or note').fill('My own useful note.');await page.getByRole('button',{name:'Use as my note',exact:true}).click()
  await page.getByLabel('How to add answer 4').selectOption('replace');await page.getByRole('button',{name:'Preview in HTML',exact:true}).last().click();await page.waitForSelector('.wb-preview')
  await page.getByRole('button',{name:'Apply to HTML',exact:true}).click();await waitFile(text=>text.includes('My own useful note.'))
  assert(fs.readFileSync(fixture,'utf8').includes('<strong><span data-word-peek="addition">My own useful note.</span></strong>'),fs.readFileSync(fixture,'utf8'))
  await page.getByRole('button',{name:'Undo last HTML change',exact:true}).click();await waitText(original)
  await page.setViewportSize({width:360,height:640});const bounds=await page.locator('#word-peek-build').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=360&&bounds.y+bounds.height<=640)
  await page.setViewportSize({width:1200,height:800});await page.getByRole('button',{name:'Close explore panel'}).click();await frame.locator('#subject strong').waitFor();await select()
  await page.getByLabel('More actions').selectOption('glossary');await page.getByLabel('Definition',{exact:true}).fill('A definition that must not be retained.')
  await page.evaluate(()=>{storageBlocked=true});await page.getByRole('button',{name:'Save definition',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'glossary could not be saved'}).waitFor();assert.equal(await page.evaluate(()=>store['entries.v1']),undefined)
  await page.evaluate(()=>{storageBlocked=false});await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert(!(await page.getByRole('dialog',{name:'Word Peek',exact:true}).innerText()).includes('A definition that must not be retained.'))
  await page.evaluate(()=>{currentSession='chat-a';currentProfile='work';rpcCalls.length=0});await select();await page.evaluate(()=>{currentSession='chat-b'})
  await page.getByLabel('More actions').selectOption('define');await page.locator('#word-peek-build .wb-body').waitFor();await waitIdle()
  assert.deepEqual(await page.evaluate(()=>rpcCalls.filter(c=>c.method==='prompt.submit').map(c=>c.params.session_id)),['chat-a'])
  await page.getByRole('button',{name:'Close explore panel'}).click();await page.evaluate(()=>{currentSession='chat-a';currentProfile='work';rpcCalls.length=0});await select()
  await page.evaluate(()=>{currentSession='chat-b';currentProfile='personal'});await page.getByLabel('More actions').selectOption('expand')
  await page.getByRole('alert').filter({hasText:/Switch back|profile/}).waitFor();assert.equal(await page.evaluate(()=>rpcCalls.filter(c=>c.method==='prompt.submit').length),0)
  assert.equal(await frame.locator('body').evaluate(()=>window.fixtureSentinel),undefined);assert.deepEqual(outbound,[])
  await page.evaluate(()=>disposers.forEach(f=>f()));assert.equal(await page.locator('#word-peek-build').count(),0);assert.equal(await page.locator('#word-peek-reader').count(),0);assert.equal(await page.evaluate(()=>eventListeners.size),0)
  console.log('PASS: SDK folder reader, inert HTML, correlated replies, followups, preview, real save/backup/Undo, concurrent edits, replacement, narrow UI, glossary quota, chat/profile switching and cleanup')
 } finally {
  await browser?.close()
  for(const entry of fs.readdirSync(tempRoot))fs.unlinkSync(scopedPath('fixture',entry))
  fs.rmdirSync(tempRoot)
 }
})().catch(error=>{console.error(error);process.exitCode=1})
