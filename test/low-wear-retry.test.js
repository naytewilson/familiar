const test = require('node:test')
const assert = require('node:assert/strict')
const { RetryableError } = require('../src/utils/retry')
const { createClipboardMirror } = require('../src/clipboard/mirror')
const { createStillsMarkdownWorker } = require('../src/screen-stills/stills-markdown-worker')

const logger = { log() {}, warn() {}, error() {} }

test('clipboard scanner failure does not spin every 500ms and retries after a cooldown', async () => {
  let nowMs = 1000
  let saveCalls = 0
  const clipboard = createClipboardMirror({
    logger,
    now: () => nowMs,
    readTextImpl: () => 'a copied multi-word secret',
    saveTextImpl: async () => {
      saveCalls += 1
      return saveCalls === 1
        ? { skipped: true, reason: 'redaction-unavailable' }
        : { path: '/tmp/fictional-clipboard.txt' }
    },
    scheduler: { setInterval: () => ({ unref() {} }), clearInterval: () => {} }
  })
  try {
    clipboard.start({ contextFolderPath: '/tmp', sessionId: 'session-test' })
    assert.equal((await clipboard.tick()).reason, 'redaction-unavailable')
    assert.equal((await clipboard.tick()).reason, 'redaction-cooldown')
    nowMs += 29999
    assert.equal((await clipboard.tick()).reason, 'redaction-cooldown')
    assert.equal(saveCalls, 1)
    nowMs += 1
    assert.equal((await clipboard.tick()).ok, true)
    assert.equal(saveCalls, 2)
  } finally {
    clipboard.stop('test')
  }
})

test('OCR redaction failure requeues only its frame, pauses OCR, and recovers later', async () => {
  let nowMs = 1000
  let extractionCalls = 0
  let attempts = 0
  let pendingCount = 0
  let doneCount = 0
  let hasPending = true
  const row = { id: 1, image_path: '/tmp/fictional-frame.webp' }
  const queue = {
    requeueStaleProcessing: () => 0,
    getPendingBatch: () => hasPending ? [row] : [],
    markProcessing: () => {},
    markPending: () => { pendingCount += 1 },
    markFailed: () => { throw new Error('A scanner outage must not permanently fail this frame') },
    markDone: () => { doneCount += 1; hasPending = false },
    close: () => {}
  }
  const worker = createStillsMarkdownWorker({
    logger,
    pollIntervalMs: 0,
    runImmediately: false,
    maxBatchesPerTick: 1,
    clockNow: () => nowMs,
    createQueueImpl: () => queue,
    createExtractorImpl: () => ({
      type: 'fake',
      execution: { maxParallelBatches: 1 },
      canRun: async () => ({ ok: true }),
      extractBatch: async () => {
        extractionCalls += 1
        return new Map([['1', { markdown: 'OCR observation' }]])
      }
    }),
    writeMarkdownFileImpl: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new RetryableError({ status: 'redaction-unavailable', message: 'rg unavailable' })
      }
      return '/tmp/fictional-frame.md'
    }
  })
  try {
    worker.start({ contextFolderPath: '/tmp' })
    await worker.runOnce()
    assert.equal(pendingCount, 1)
    assert.equal(extractionCalls, 1)

    nowMs += 5000
    await worker.runOnce()
    assert.equal(extractionCalls, 1, 'OCR should not rerun during scanner outage')

    nowMs += 25000
    await worker.runOnce()
    assert.equal(doneCount, 1)
    assert.equal(extractionCalls, 2)
  } finally {
    worker.stop()
  }
})
