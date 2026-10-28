import test from 'node:test'
import assert from 'node:assert/strict'
import {fileAddress,fileUrl,parseAddress,createFileAdapter} from './sdk-files.js'

test('folder handles and relative filenames survive URL encoding without escaping the grant',()=>{
  const address=decodeURIComponent(new URL(fileUrl('grant-1','folder with spaces/report #20%.html')).pathname)
  assert.deepEqual(parseAddress(address),{folder:'grant-1',path:'folder with spaces/report #20%.html'})
  for(const path of ['../secret','a/../b','/absolute','a//b','C:\\secret','a\0b']) assert.throws(()=>fileAddress('grant-1',path))
  assert.throws(()=>parseAddress('/etc/passwd'))
  assert.throws(()=>parseAddress('/word-peek-grants/grant-1/../secrets'))
})
test('SDK failures are errors and backup writes remain exclusive',async()=>{
  const calls=[]
  const api=createFileAdapter({
    readText:async()=>({ok:false,error:'revoked',message:'Folder permission was revoked.'}),
    writeText:async(...args)=>{calls.push(args);return {ok:false,error:'exists',message:'File already exists.'}}
  })
  await assert.rejects(api.readHtml('/word-peek-grants/grant-1/doc.html'),/revoked/)
  await assert.rejects(api.writeHtml('/word-peek-grants/grant-1/doc.html.bak','old',{exclusive:true}),/already exists/)
  assert.deepEqual(calls[0],['grant-1','doc.html.bak','old',{exclusive:true}])
})
test('file API rejects oversized or incomplete reads and oversized writes',async()=>{
  let writes=0
  const api=createFileAdapter({readText:async()=>({ok:true,text:'x'.repeat(900001)}),writeText:async()=>{writes++;return {ok:true}}})
  await assert.rejects(api.readHtml('/word-peek-grants/g/doc.html'),/900,000/)
  await assert.rejects(api.writeHtml('/word-peek-grants/g/doc.html','x'.repeat(900001)),/900,000/)
  assert.equal(writes,0)
})
