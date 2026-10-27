// Unit tests for html-agent.js: free-form whole-document edits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEditedHtml, requestHtmlEdit } from './html-agent.js'

const DOC = '<!DOCTYPE html><html><head><title>t</title></head><body><p>' + 'x'.repeat(500) + '</p></body></html>'

test('validateEditedHtml accepts a complete rewrite', () => {
  const edited = DOC.replace('<p>', '<style>p{animation:glow 2s}</style><p>')
  assert.equal(validateEditedHtml(edited, DOC), edited)
})

test('validateEditedHtml rejects fences, missing html tags, unbalanced scripts, truncation', () => {
  assert.throws(() => validateEditedHtml('```html\n' + DOC + '\n```', DOC), /code fences/)
  assert.throws(() => validateEditedHtml('<p>no html tags here ' + 'y'.repeat(500) + '</p>', DOC), /complete HTML page/)
  assert.throws(() => validateEditedHtml('<html><body><script>a' + 'z'.repeat(500) + '</body></html>', DOC), /unclosed <script>/)
  assert.throws(() => validateEditedHtml('<html><body>tiny</body></html>', DOC), /lost most of the original/)
  assert.throws(() => validateEditedHtml('<html><html><body>' + 'w'.repeat(500) + '</body></html>', DOC), /nested or repeated/)
})

function mockHost(replyText) {
  const listeners = []
  return {
    state: { focusedSessionId: 'sess-1' },
    request: async (method) => {
      if (method === 'prompt.submit') setTimeout(() => listeners.forEach(cb => cb({ session_id: 'sess-1', payload: { status: 'complete', text: replyText } })), 5)
    },
    onEvent: (_kind, cb) => { listeners.push(cb); return () => {} }
  }
}

test('requestHtmlEdit round-trips: reads, submits, validates, writes, verifies', async () => {
  let saved = null
  const edited = DOC.replace('</head>', '<style>p{animation:g 1s}</style></head>')
  const reply = JSON.stringify({ summary: 'Added an animation.', html: edited })
  const host = mockHost(reply)
  const result = await requestHtmlEdit(host, {
    filePath: '/tmp/doc.html',
    instruction: 'add an animation',
    readHtml: async () => saved ?? DOC,
    writeHtml: async text => { saved = text }
  })
  assert.equal(saved, edited)
  assert.equal(result.summary, 'Added an animation.')
  assert.equal(result.before, DOC)
})

test('requestHtmlEdit refuses to write when the file changed mid-flight', async () => {
  const edited = DOC.replace('</head>', '<style>p{animation:g 1s}</style></head>')
  const host = mockHost(JSON.stringify({ summary: 'ok', html: edited }))
  let reads = 0
  let wrote = false
  await assert.rejects(requestHtmlEdit(host, {
    filePath: '/tmp/doc.html',
    instruction: 'animate',
    readHtml: async () => { reads += 1; return reads === 1 ? DOC : DOC + '<!-- touched -->' },
    writeHtml: async () => { wrote = true }
  }), /file changed while Hermes was working/)
  assert.equal(wrote, false)
})

test('requestHtmlEdit rejects a malformed reply without writing', async () => {
  const host = mockHost('sorry, I could not do that')
  let wrote = false
  await assert.rejects(requestHtmlEdit(host, {
    filePath: '/tmp/doc.html',
    instruction: 'animate',
    readHtml: async () => DOC,
    writeHtml: async () => { wrote = true }
  }), /did not return an edit/)
  assert.equal(wrote, false)
})

test('requestHtmlEdit tolerates prose around the JSON reply', async () => {
  const edited = DOC.replace('</head>', '<audio src="a.mp3"></audio></head>')
  const host = mockHost('Sure! Here is the edit:\n' + JSON.stringify({ summary: 'Added audio.', html: edited }))
  let saved = null
  const result = await requestHtmlEdit(host, {
    filePath: '/tmp/doc.html', instruction: 'add voice',
    readHtml: async () => saved ?? DOC, writeHtml: async t => { saved = t }
  })
  assert.equal(saved, edited)
  assert.equal(result.summary, 'Added audio.')
})
