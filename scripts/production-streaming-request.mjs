import assert from 'node:assert/strict'
import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'

export async function productionStreamingRequest(url, {chunks, signal, timeoutMs = 45000, headers}) {
  assert(chunks && typeof chunks[Symbol.asyncIterator] === 'function')
  assert(Number.isInteger(timeoutMs) && timeoutMs > 30000 && timeoutMs <= 45000)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal) {signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort()}
  const timer = setTimeout(abort, timeoutMs)
  try {
    return await new Promise((accept, reject) => {
      let settled = false
      const finish = (error, response) => {
        if (settled) return
        settled = true
        error ? reject(error) : accept(response)
      }
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {method: 'POST', signal: controller.signal, headers}, incoming => {
        const buffers = []; let size = 0
        incoming.on('data', bytes => {
          size += bytes.length
          if (size > 1048576) {incoming.destroy(); finish(new Error('Streaming response exceeded its limit')); request.destroy()}
          else buffers.push(bytes)
        })
        incoming.on('error', error => finish(error))
        incoming.on('end', () => {
          const response = new Response(Buffer.concat(buffers), {status: incoming.statusCode,
            headers: Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => typeof value === 'string'))})
          finish(null, response)
          request.destroy()
        })
      })
      request.on('error', error => finish(error))
      ;(async () => {
        for await (const chunk of chunks) {
          if (settled || controller.signal.aborted || request.destroyed) break
          assert(typeof chunk === 'string' || Buffer.isBuffer(chunk) || chunk instanceof Uint8Array)
          request.write(chunk)
        }
        if (!settled && !request.destroyed) request.end()
      })().catch(error => {finish(error); request.destroy()})
    })
  } catch {
    if (controller.signal.aborted) {const error = new Error('Streaming HTTP cancelled or timed out'); error.name = 'AbortError'; throw error}
    throw new Error('Streaming API transport failed')
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort)}
}
