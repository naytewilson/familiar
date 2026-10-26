const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { scanAndRedactContent } = require('../src/security/rg-redaction')
const { saveClipboardMirrorToDirectory } = require('../src/clipboard/storage')
const { writeMarkdownFile } = require('../src/screen-stills/stills-markdown-worker')
const { createTranscriptWriter } = require('../src/meeting-recording/transcript-writer')

const bypassResult = (content) => ({
  content,
  findings: 0,
  ruleCounts: {},
  redactionBypassed: true,
  dropContent: false,
  dropReason: null
})

test('scanner failure drops all text rather than persisting an unredacted secret', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'familiar-rg-failure-'))
  const stub = path.join(dir, 'rg-failure')
  const previous = process.env.FAMILIAR_RG_BINARY
  fsSync.writeFileSync(stub, '#!/bin/sh\nexit 2\n', { mode: 0o755 })
  process.env.FAMILIAR_RG_BINARY = stub
  try {
    const result = await scanAndRedactContent({ content: 'api_key=secret-value-1234567890' })
    assert.equal(result.dropContent, true)
    assert.equal(result.content, '')
    assert.equal(result.redactionBypassed, true)
  } finally {
    if (previous === undefined) delete process.env.FAMILIAR_RG_BINARY
    else process.env.FAMILIAR_RG_BINARY = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('clipboard cannot save dropped or unscanned sensitive content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'familiar-clipboard-fail-'))
  try {
    for (const result of [
      { ...bypassResult('sensitive clipboard value') },
      { ...bypassResult('private seed phrase'), dropContent: true, dropReason: 'crypto-seed-phrase', redactionBypassed: false }
    ]) {
      const output = await saveClipboardMirrorToDirectory({
        text: result.content,
        directory: dir,
        options: { scanAndRedactContentImpl: async () => result }
      })
      assert.equal(output.skipped, true)
    }
    assert.deepEqual(await fs.readdir(dir), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('stills OCR markdown is not written if redaction was bypassed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'familiar-markdown-fail-'))
  const imagePath = path.join(dir, 'familiar', 'stills', 'session-test', 'frame.webp')
  try {
    await assert.rejects(writeMarkdownFile({
      contextFolderPath: dir,
      imagePath,
      markdown: 'secret text on the screen',
      scanAndRedactContentImpl: async ({ content }) => bypassResult(content)
    }), /redaction/i)
    const outputPath = path.join(dir, 'familiar', 'stills-markdown', 'session-test', 'frame.md')
    assert.equal(fsSync.existsSync(outputPath), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('meeting transcript cannot save unscanned sensitive text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'familiar-transcript-fail-'))
  const transcriptMarkdownPath = path.join(dir, 'meeting.transcript.md')
  const writer = createTranscriptWriter({
    transcriptMarkdownPath,
    scanAndRedactContentImpl: async ({ content }) => bypassResult(content)
  })
  try {
    await assert.rejects(writer.writeEvent({
      type: 'final', text: 'secret token 1234567890', startedAtMs: 100
    }), /redaction/i)
    const content = await fs.readFile(transcriptMarkdownPath, 'utf-8')
    assert.doesNotMatch(content, /secret token/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
