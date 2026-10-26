const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('identical screen samples avoid rendering and writing, while new content or context still records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'familiar-low-wear-'))
  const ipcMain = new EventEmitter()
  const queued = []
  let rendered = 0
  let fileSequence = 0
  let tick = null
  let currentTitle = 'Editor - file A'
  let currentFrame = Buffer.concat([PNG_HEADER, Buffer.from('frame A')])
  const originalLoad = Module._load

  function BrowserWindowStub() {
    this.webContents = new EventEmitter()
    this.webContents.getURL = () => 'file://stills.html'
    this.webContents.send = (channel, payload) => {
      if (channel === 'screen-stills:capture') {
        rendered += 1
        process.nextTick(() => ipcMain.emit('screen-stills:status', {}, {
          requestId: payload.requestId,
          status: 'captured',
          imageBuffer: Buffer.from('webp-' + rendered)
        }))
      } else if (channel === 'screen-stills:start' || channel === 'screen-stills:stop') {
        process.nextTick(() => ipcMain.emit('screen-stills:status', {}, {
          requestId: payload.requestId,
          status: channel === 'screen-stills:start' ? 'started' : 'stopped'
        }))
      }
    }
    this.loadFile = () => process.nextTick(() => {
      this.webContents.emit('did-finish-load')
      ipcMain.emit('screen-stills:ready', { sender: this.webContents })
    })
    this.on = () => {}
    this.isDestroyed = () => false
    this.destroy = () => {}
  }

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        BrowserWindow: BrowserWindowStub,
        ipcMain,
        app: { getVersion: () => 'test' },
        desktopCapturer: {
          getSources: async () => [{
            id: 'screen:1',
            display_id: '1',
            thumbnail: {
              toPNG: () => Buffer.from(currentFrame),
              toDataURL: () => 'data:image/png;base64,' + currentFrame.toString('base64'),
              getSize: () => ({ width: 640, height: 480 })
            }
          }]
        },
        screen: {
          getAllDisplays: () => [{ id: 1, bounds: { width: 1000, height: 800 }, scaleFactor: 1 }],
          getPrimaryDisplay: () => ({ id: 1, bounds: { width: 1000, height: 800 }, scaleFactor: 1 })
        }
      }
    }
    if (request === '../screen-capture/permissions') {
      return { isScreenRecordingPermissionGranted: () => true }
    }
    if (request === './session-store') {
      return { createSessionStore: ({ contextFolderPath }) => ({
        sessionId: 'session-test',
        sessionDir: path.join(contextFolderPath, 'familiar', 'stills', 'session-test'),
        nextCaptureFile: (capturedAt) => ({
          fileName: 'frame-' + (++fileSequence) + '.webp',
          capturedAt: capturedAt.toISOString()
        })
      }) }
    }
    if (request === './stills-queue') {
      return { createStillsQueue: () => ({
        enqueueCapture: (entry) => { queued.push(entry); return true },
        close: () => {}
      }) }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const recorderPath = require.resolve('../src/screen-stills/recorder')
  delete require.cache[recorderPath]
  let recorder
  const pause = () => new Promise((resolve) => setTimeout(resolve, 80))
  try {
    const { createRecorder } = require('../src/screen-stills/recorder')
    recorder = createRecorder({
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      intervalSeconds: 1,
      loadSettingsImpl: () => ({ capturePrivacy: { blacklistedApps: [] } }),
      createActiveWindowDetectorImpl: () => ({
        detectWindowCandidates: async () => [{
          name: 'Editor', bundleId: 'com.example.editor', title: currentTitle, pid: 7, active: true
        }]
      }),
      lowPowerModeMonitor: {
        start: () => {}, stop: () => {}, on: () => {}, off: () => {},
        isLowPowerModeEnabled: () => false
      },
      scheduler: {
        setInterval: (callback) => { tick = callback; return { unref() {} } },
        clearInterval: () => { tick = null }
      }
    })

    const started = await recorder.start({ contextFolderPath: root })
    assert.equal(started.ok, true)
    assert.equal(rendered, 1)
    assert.equal(queued.length, 1)
    assert.ok(tick)

    tick()
    await pause()
    assert.equal(rendered, 1, 'duplicate frame should not reach the WebP renderer')
    assert.equal(queued.length, 1, 'duplicate frame should not reach OCR queue')

    currentTitle = 'Editor - file B'
    tick()
    await pause()
    assert.equal(rendered, 2, 'a window-title change must be captured even with identical pixels')
    assert.equal(queued.length, 2)

    currentFrame = Buffer.concat([PNG_HEADER, Buffer.from('frame B')])
    tick()
    await pause()
    assert.equal(rendered, 3, 'a content change must be captured at the usual sampling interval')
    assert.equal(queued.length, 3)

    const files = fs.readdirSync(path.join(root, 'familiar', 'stills', 'session-test'))
    assert.equal(files.length, 3)
  } finally {
    if (recorder) await recorder.stop({ reason: 'test' })
    Module._load = originalLoad
    delete require.cache[recorderPath]
    fs.rmSync(root, { recursive: true, force: true })
  }
})
