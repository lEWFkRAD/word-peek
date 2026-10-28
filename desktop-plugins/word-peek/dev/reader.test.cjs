const assert = require('node:assert/strict')
const path = require('node:path')
const {dependency} = require('./runtime.cjs')
const {chromium} = dependency('playwright')
const bundle = dependency('esbuild').buildSync({
  entryPoints:[path.join(__dirname,'reader.js')],bundle:true,write:false,format:'iife',globalName:'WordPeekReader'
}).outputFiles[0].text

;(async()=>{
  const options={headless:true}
  if(process.env.PLAYWRIGHT_CHANNEL)options.channel=process.env.PLAYWRIGHT_CHANNEL
  const browser=await chromium.launch(options)
  try {
    const page=await browser.newPage()
    const requests=[]
    await page.route('**/*',route=>{
      if(route.request().url()==='https://word-peek.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'})
      requests.push(route.request().url());return route.abort()
    })
    await page.goto('https://word-peek.test/')
    await page.addScriptTag({content:bundle})
    const structure=await page.evaluate(()=>{
      const parsed=new DOMParser().parseFromString(WordPeekReader.readerHtml('<html><head><base href="https://blocked.test/"></head><body><meta http-equiv="refresh" content="0"><p>Passage without an ID</p></body></html>'),'text/html')
      return {children:Array.from(parsed.body.children).map(n=>n.tagName),base:parsed.querySelector('base').hasAttribute('href'),refresh:parsed.body.querySelector('meta').hasAttribute('http-equiv')}
    })
    assert.deepEqual(structure,{children:['META','P'],base:false,refresh:false})
    await page.evaluate(()=>{
      window.selected=null
      window.reader=WordPeekReader.createReader({files:{
        folders:async()=>[],
        requestFolder:async()=>({ok:true,folder:{id:'fixture',name:'Documents',path:'/example'}}),
        list:async()=>({ok:true,entries:[{name:'study.html',path:'study.html',isDirectory:false}],truncated:false}),
        readText:async()=>({ok:true,text:'<!doctype html><html><head><meta http-equiv="refresh" content="0; url=https://blocked.test/refresh"><script>parent.scriptRan=true; fetch("https://blocked.test/script")</script><style>body{background-image:url(https://blocked.test/css)}</style></head><body><p id="subject">Hello <strong>world</strong>. <a href="https://example.org/reference">Reference</a><a href="/relative">Relative</a></p><img src="https://blocked.test/image"></body></html>'}),
        writeText:async()=>({ok:true})
      }},(passage,guest)=>{window.selected=passage;window.guest=guest})
      return reader.open()
    })
    await page.getByRole('button',{name:'study.html',exact:true}).click()
    await page.frameLocator('#word-peek-reader iframe').locator('#subject').waitFor()
    await page.evaluate(()=>{
      const frame=document.querySelector('#word-peek-reader iframe'),win=frame.contentWindow
      const r=win.document.createRange();r.selectNodeContents(win.document.querySelector('strong'))
      win.getSelection().removeAllRanges();win.getSelection().addRange(r)
      win.document.querySelector('strong').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))
    })
    const result=await page.evaluate(()=>({selected,scriptRan:Boolean(window.scriptRan)}))
    assert.equal(result.selected.selectedText,'world')
    assert.equal(result.selected.url,'file:///word-peek-grants/fixture/study.html')
    assert.deepEqual(result.selected.sources.map(s=>s.url),['https://example.org/reference'])
    assert.equal(result.scriptRan,false)
    assert.deepEqual(requests,[])
    await page.evaluate(()=>guest.reload())
    await page.frameLocator('#word-peek-reader iframe').locator('#subject').waitFor()
    assert.equal(await page.evaluate(()=>guest.isConnected),true)
    await page.evaluate(()=>guest.reload())
    assert.equal(await page.evaluate(()=>guest.isConnected),true)
    await page.evaluate(()=>reader.dispose())
    assert.equal(await page.locator('#word-peek-reader').count(),0)

    await page.evaluate(()=>{
      window.delayed=WordPeekReader.createReader({files:{
        folders:async()=>[],requestFolder:()=>new Promise(resolve=>window.resolvePicker=resolve),
        readText:async()=>({ok:true,text:''}),writeText:async()=>({ok:true})
      }},()=>{})
      window.opening=delayed.open()
    })
    await page.waitForFunction(()=>typeof window.resolvePicker==='function')
    await page.evaluate(async()=>{
      delayed.dispose()
      resolvePicker({ok:true,folder:{id:'fixture',name:'Documents'}})
      await opening
    })
    assert.equal(await page.locator('#word-peek-reader').count(),0)
    console.log('PASS: SDK reader permission routing, inert content, source URLs, repeat reload, disposal')
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
