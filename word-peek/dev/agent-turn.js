/** Correlate chat replies using gateway receipts, never text markers or session id alone. */
const activeTurns = new Set()
const TIMEOUT = 300000
const atomValue = atom => typeof atom?.get === 'function' ? atom.get() : atom?.current ?? atom
const validRow = value => Number.isSafeInteger(value) && value > 0
const cancelled = () => Object.assign(new Error('Request cancelled. The chat may still finish a submitted turn.'), { name: 'AbortError' })
export function pinAgentSession(host, { sessionId, sessionOwner } = {}) {
  const state = host?.state || {}
  const id = sessionId || atomValue(state.focusedSessionId) || atomValue(state.activeSessionId)
  const owner = sessionOwner === undefined ? atomValue(state.focusedSessionOwner) : sessionOwner
  if (typeof id !== 'string' || !id.trim()) throw new Error('Open a chat to ask Hermes.')
  if ((!owner && state.focusedSessionOwner !== undefined) || (owner && (typeof owner.connectionId !== 'string' || !owner.connectionId.trim() || typeof owner.profile !== 'string' || !owner.profile.trim()))) throw new Error('The passage has no reliable chat owner. Select it again.')
  return { sessionId: id, sessionOwner: owner ? { connectionId: owner.connectionId, profile: owner.profile } : null }
}
export async function requestAgentTurn(host, { sessionId, sessionOwner, text, signal } = {}) {
  if (signal?.aborted) throw cancelled()
  const pinned = pinAgentSession(host, { sessionId, sessionOwner })
  const owner = pinned.sessionOwner, sid = pinned.sessionId, state = host?.state || {}
  const key = JSON.stringify([owner?.connectionId, owner?.profile, sid])
  const checkOwner = () => {
    if (!owner) return
    const connection = state.connectionId === undefined ? undefined : atomValue(state.connectionId) || 'local'
    const profile = state.profile === undefined ? undefined : atomValue(state.profile)
    if ((connection !== undefined && connection !== owner.connectionId) || (profile !== undefined && profile !== owner.profile)) throw new Error('Switch back to the original chat profile before continuing.')
  }
  checkOwner()
  if (activeTurns.has(key)) throw new Error('Word Peek is already waiting for this chat. Wait for it to finish.')
  if (typeof host?.onEvent !== 'function') throw new Error('This Hermes build cannot watch the chat for an answer.')
  activeTurns.add(key)
  let off, timer, release, closed = false, identity, submitted = false, resolveReply, rejectReply, rejectFailure
  const buffered = [], subscriptions = []
  const reply = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject })
  const failure = new Promise((_, reject) => { rejectFailure = reject })
  reply.catch(() => {}); failure.catch(() => {})
  const fail = error => { rejectReply(error); rejectFailure(error) }
  const abort = () => fail(cancelled())
  const check = () => { if (signal?.aborted) throw cancelled(); checkOwner() }
  const wait = async operation => {
    check()
    const value = await Promise.race([Promise.resolve().then(() => { check(); return operation() }), failure])
    check()
    if (value?.error) throw new Error(value.error.message || 'Hermes rejected the request.')
    return value?.jsonrpc && Object.hasOwn(value, 'result') ? value.result : value
  }
  const accept = event => {
    const payload = event?.payload || {}, proof = payload.persisted_turn
    if (!proof || (identity.kind === 'row' ? !validRow(proof.user_row_id) : typeof proof.submission_id !== 'string')) {
      fail(new Error('The chat completion has no verifiable turn receipt. Read the answer in chat.')); return
    }
    if (identity.kind === 'row' ? proof.user_row_id !== identity.value : proof.submission_id !== identity.value) return
    if (Array.isArray(proof.user_row_ids) && proof.user_row_ids.length > 1) {
      fail(new Error('This turn changed to include multiple user inputs. Read its answer in chat.')); return
    }
    if (payload.status && payload.status !== 'complete') { fail(new Error('Hermes could not finish the request (' + payload.status + ').')); return }
    resolveReply(typeof payload.text === 'string' ? payload.text : typeof payload.rendered === 'string' ? payload.rendered : '')
  }
  try {
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => fail(new Error('The request took too long. Check the chat before trying again.')), TIMEOUT)
    for (const atom of [state.connectionId, state.profile]) if (typeof atom?.subscribe === 'function') {
      const dispose = atom.subscribe(() => { try { checkOwner() } catch (error) { fail(error) } })
      if (typeof dispose === 'function') subscriptions.push(dispose)
    }
    off = host.onEvent('message.complete', event => {
      if (closed || event?.session_id !== sid || !submitted) return
      try {
        check()
        if (identity) accept(event)
        else if (buffered.length < 64) buffered.push(event)
        else fail(new Error('Too many ambiguous chat completions. Check the chat before trying again.'))
      } catch (error) { fail(error) }
    })
    if (typeof off !== 'function') throw new Error('This Hermes build cannot watch the chat for an answer.')
    let request
    if (owner && typeof host.profileRoutes === 'function' && typeof host.requestProfile === 'function') {
      const routes = await wait(() => host.profileRoutes())
      const route = routes.find(item => item.connectionId === owner.connectionId && item.profile === owner.profile)
      if (!route) throw new Error('The gateway for this passage is no longer connected.')
      if (typeof host.retainProfile === 'function') {
        await wait(() => Promise.resolve(host.retainProfile(route)).then(dispose => { if (closed) dispose?.(); else release = dispose }))
      } else if (typeof host.retainProfileSocket === 'function') release = host.retainProfileSocket(route)
      request = (method, params, timeout) => host.requestProfile(route, method, params, timeout)
    } else {
      const gateway = host.getGateway?.()
      if (typeof gateway?.request === 'function') request = (method, params, timeout) => gateway.request(method, params, timeout, signal)
      else if (typeof host.request === 'function') request = (method, params) => host.request(method, params)
      else throw new Error('Hermes is not connected. Reconnect to ask a question.')
    }
    const resumed = await wait(() => request('session.resume', { session_id: sid, defer_history: true, omit_messages: true }, 30000))
    if (resumed?.running || resumed?.status === 'streaming' || resumed?.pending?.length) throw new Error('This chat is busy. Wait for its current turn to finish.')
    if (resumed?.session_id && resumed.session_id !== sid) throw new Error('This chat session changed. Select the passage again.')
    const canonical = resumed?.info?.desktop_protocol === 'hermes-gateway-v1'
    const submissionId = canonical ? globalThis.crypto.randomUUID() : null
    const params = { session_id: sid, text, queued: true, ...(canonical ? { submission_id: submissionId } : {}) }
    check(); submitted = true
    const receipt = await wait(() => request('prompt.submit', params, TIMEOUT))
    if (canonical) {
      if (!receipt?.admission_id || !['queued', 'started', 'terminal'].includes(receipt.status) || receipt.ref?.session_id !== sid) throw new Error('The request admission receipt is ambiguous. Check the chat; no answer was applied.')
      identity = { kind: 'submission', value: submissionId }
    } else {
      if (receipt?.status !== 'streaming') throw new Error('The request was ' + (receipt?.status || 'not acknowledged') + '. Check the chat; no answer was applied.')
      if (!validRow(receipt.user_row_id)) throw new Error('Hermes did not return a verifiable turn receipt. Read the answer in chat.')
      identity = { kind: 'row', value: receipt.user_row_id }
    }
    for (const event of buffered) accept(event)
    const result = await Promise.race([reply, failure])
    check()
    return result
  } finally {
    closed = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    activeTurns.delete(key)
    for (const dispose of [off,release,...subscriptions]) {
      if (typeof dispose === 'function') { try { dispose() } catch (error) { console.warn('[word-peek] request cleanup failed',error) } }
    }
  }
}
