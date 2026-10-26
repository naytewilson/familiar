const { createHash } = require('node:crypto')

const DEFAULT_CHECKPOINT_INTERVAL_MS = 30 * 1000

const windowKey = (window) => {
  if (!window || typeof window !== 'object') {
    return null
  }
  return [
    window.bundleId || '',
    window.name || '',
    window.title || '',
    Number.isFinite(window.pid) ? String(window.pid) : '',
    window.active === true ? '1' : '0'
  ]
}

const snapshotKey = (snapshot) => {
  if (!snapshot?.activeWindow || !Array.isArray(snapshot.visibleWindows)) {
    return null
  }
  const active = windowKey(snapshot.activeWindow)
  const visible = snapshot.visibleWindows.map(windowKey).filter(Boolean)
  return JSON.stringify({ active, visible: visible.map((value) => JSON.stringify(value)).sort() })
}

const createCaptureDeduplicator = ({
  checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS
} = {}) => {
  const intervalMs = Number.isFinite(checkpointIntervalMs) && checkpointIntervalMs > 0
    ? Math.floor(checkpointIntervalMs)
    : DEFAULT_CHECKPOINT_INTERVAL_MS
  let previous = null
  const stats = { samples: 0, skipped: 0, saved: 0, checkpoints: 0 }

  const evaluate = ({
    thumbnailPng,
    sourceId,
    displayId,
    width,
    height,
    windowSnapshot,
    capturedAt
  } = {}) => {
    stats.samples += 1
    if (!Buffer.isBuffer(thumbnailPng) || thumbnailPng.length === 0) {
      return { skip: false, candidate: null, reason: 'missing-png' }
    }
    const contextKey = snapshotKey(windowSnapshot)
    if (!contextKey) {
      return { skip: false, candidate: null, reason: 'missing-window-context' }
    }

    const timestampMs = capturedAt instanceof Date ? capturedAt.getTime() : NaN
    if (!Number.isFinite(timestampMs)) {
      return { skip: false, candidate: null, reason: 'invalid-time' }
    }

    const candidate = {
      fingerprint: createHash('sha256').update(thumbnailPng).digest('hex'),
      sourceId: String(sourceId ?? ''),
      displayId: String(displayId ?? ''),
      width,
      height,
      contextKey,
      timestampMs
    }

    const unchanged = previous &&
      previous.fingerprint === candidate.fingerprint &&
      previous.sourceId === candidate.sourceId &&
      previous.displayId === candidate.displayId &&
      previous.width === candidate.width &&
      previous.height === candidate.height &&
      previous.contextKey === candidate.contextKey

    if (unchanged && timestampMs >= previous.timestampMs &&
        timestampMs - previous.timestampMs < intervalMs) {
      stats.skipped += 1
      return { skip: true, candidate: null, reason: 'identical' }
    }
    return {
      skip: false,
      candidate,
      reason: unchanged ? 'checkpoint' : 'changed'
    }
  }

  const markSaved = (candidate, { beforeSnapshot, afterSnapshot, reason } = {}) => {
    stats.saved += 1
    if (reason === 'checkpoint') {
      stats.checkpoints += 1
    }
    // Never infer a stable app/window identity across a mid-capture switch.
    if (candidate && snapshotKey(beforeSnapshot) === snapshotKey(afterSnapshot) &&
        snapshotKey(afterSnapshot)) {
      previous = candidate
    } else {
      previous = null
    }
  }

  const reset = () => {
    previous = null
    stats.samples = 0
    stats.skipped = 0
    stats.saved = 0
    stats.checkpoints = 0
  }

  return {
    evaluate,
    markSaved,
    reset,
    getStats: () => ({ ...stats })
  }
}

module.exports = {
  DEFAULT_CHECKPOINT_INTERVAL_MS,
  createCaptureDeduplicator,
  snapshotKey
}
