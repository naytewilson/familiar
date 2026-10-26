const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createCaptureDeduplicator,
  snapshotKey
} = require('../src/screen-stills/capture-deduplicator')

const windowSnapshot = (title = 'Editor', visible = []) => ({
  activeWindow: { bundleId: 'com.editor', name: 'Editor', title, active: true, pid: 11 },
  visibleWindows: [
    { bundleId: 'com.editor', name: 'Editor', title, active: true, pid: 11 },
    ...visible
  ]
})

const sample = ({ content = 'same', title = 'Editor', timestampMs = 0, displayId = 1, visible = [] } = {}) => ({
  thumbnailPng: Buffer.from(content),
  sourceId: 'screen:1',
  displayId,
  width: 640,
  height: 360,
  windowSnapshot: windowSnapshot(title, visible),
  capturedAt: new Date(timestampMs)
})

test('unchanged pixels and app metadata are skipped without losing the checkpoint', () => {
  const dedup = createCaptureDeduplicator({ checkpointIntervalMs: 30000 })
  const first = sample({ timestampMs: 1000 })
  const decision = dedup.evaluate(first)
  assert.equal(decision.skip, false)
  dedup.markSaved(decision.candidate, {
    beforeSnapshot: first.windowSnapshot,
    afterSnapshot: first.windowSnapshot,
    reason: decision.reason
  })

  assert.equal(dedup.evaluate(sample({ timestampMs: 6000 })).skip, true)
  assert.equal(dedup.evaluate(sample({ timestampMs: 25999 })).skip, true)

  const checkpoint = sample({ timestampMs: 31000 })
  const checkpointDecision = dedup.evaluate(checkpoint)
  assert.equal(checkpointDecision.skip, false)
  assert.equal(checkpointDecision.reason, 'checkpoint')
  dedup.markSaved(checkpointDecision.candidate, {
    beforeSnapshot: checkpoint.windowSnapshot,
    afterSnapshot: checkpoint.windowSnapshot,
    reason: checkpointDecision.reason
  })
  assert.equal(dedup.evaluate(sample({ timestampMs: 36000 })).skip, true)
  assert.deepEqual(dedup.getStats(), { samples: 5, skipped: 3, saved: 2, checkpoints: 1 })
})

test('even a one-byte screen or metadata change is kept', () => {
  const dedup = createCaptureDeduplicator()
  const first = sample({ timestampMs: 1000 })
  const firstDecision = dedup.evaluate(first)
  dedup.markSaved(firstDecision.candidate, {
    beforeSnapshot: first.windowSnapshot,
    afterSnapshot: first.windowSnapshot
  })
  assert.equal(dedup.evaluate(sample({ content: 'samE', timestampMs: 6000 })).skip, false)
  assert.equal(dedup.evaluate(sample({ title: 'New title', timestampMs: 6000 })).skip, false)
  assert.equal(dedup.evaluate(sample({ displayId: 2, timestampMs: 6000 })).skip, false)
  assert.equal(dedup.evaluate(sample({
    timestampMs: 6000,
    visible: [{ name: 'Dialog', bundleId: 'app.dialog', title: 'Save?', active: false, pid: 12 }]
  })).skip, false)
})

test('uncertain window context or failed recording never suppresses future samples', () => {
  const dedup = createCaptureDeduplicator()
  const first = sample({ timestampMs: 1000 })
  const firstDecision = dedup.evaluate(first)
  const after = windowSnapshot('Different window')
  dedup.markSaved(firstDecision.candidate, {
    beforeSnapshot: first.windowSnapshot,
    afterSnapshot: after
  })
  assert.equal(dedup.evaluate(sample({ timestampMs: 6000 })).skip, false)

  const second = dedup.evaluate(sample({ timestampMs: 11000 }))
  assert.equal(second.skip, false)
  // Deliberately do not call markSaved; the write/queue might have failed.
  assert.equal(dedup.evaluate(sample({ timestampMs: 16000 })).skip, false)
})

test('unknown active window or missing image makes deduplication fail open to capture', () => {
  const dedup = createCaptureDeduplicator()
  assert.equal(dedup.evaluate({ ...sample(), windowSnapshot: { visibleWindows: [] } }).skip, false)
  assert.equal(dedup.evaluate({ ...sample(), thumbnailPng: null }).skip, false)
  assert.equal(dedup.evaluate({ ...sample(), capturedAt: new Date(NaN) }).skip, false)
})

test('visible window order is not a semantic change', () => {
  const a = windowSnapshot('Editor', [
    { name: 'Console', title: 'Logs', bundleId: 'com.console' },
    { name: 'Browser', title: 'Docs', bundleId: 'com.browser' }
  ])
  const b = windowSnapshot('Editor', [
    { name: 'Browser', title: 'Docs', bundleId: 'com.browser' },
    { name: 'Console', title: 'Logs', bundleId: 'com.console' }
  ])
  assert.equal(snapshotKey(a), snapshotKey(b))
})
