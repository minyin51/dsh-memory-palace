/** 存储层单测：增量、冲突覆盖、用户隔离、敏感策略、容量上限。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MemoryStore, type SensitiveMode } from '../src/store.ts'
import type { MemoryCandidate } from '../src/types.ts'

/** 建一个临时库。 */
function open(options: { sensitiveMode?: SensitiveMode; max?: number } = {}): { dir: string; file: string; store: MemoryStore } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-user-memory-'))
  const file = join(dir, 'memory.json')
  const store = new MemoryStore(file, { maxEntriesPerUser: options.max ?? 100, sensitiveMode: options.sensitiveMode ?? 'drop' })
  store.load()
  return { dir, file, store }
}

/** 造一条候选记忆。 */
function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    type: 'interest',
    content: '喜欢星穹铁道',
    keywords: ['星穹铁道'],
    importance: 0.6,
    stability: 0.7,
    sensitivity: 'normal',
    ...overrides,
  }
}

test('同一内容重复写入只累加 hits，不新增条目', () => {
  const { dir, store } = open()
  try {
    const first = store.upsert('u1', candidate())
    const second = store.upsert('u1', candidate())
    assert.equal(first.action, 'added')
    assert.equal(second.action, 'merged')
    const entries = store.list('u1')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.hits, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同主体矛盾内容覆盖旧版本，旧内容进 conflicts', () => {
  const { dir, store } = open()
  try {
    store.upsert('u1', candidate({ type: 'preference', content: '习惯用 VSCode', keywords: ['vscode'], subject: '编辑器' }))
    const result = store.upsert('u1', candidate({ type: 'preference', content: '换成用 JetBrains 了', keywords: ['jetbrains'], subject: '编辑器' }))
    assert.equal(result.action, 'overwritten')
    const entries = store.list('u1')
    assert.equal(entries.length, 1)
    assert.match(entries[0]?.content ?? '', /JetBrains/)
    assert.equal(entries[0]?.conflicts.length, 1)
    assert.match(entries[0]?.conflicts[0]?.content ?? '', /VSCode/)
    assert.ok((entries[0]?.conflicts[0]?.replaced_at ?? '').length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('不同主体并存，互不覆盖', () => {
  const { dir, store } = open()
  try {
    store.upsert('u1', candidate({ content: '喜欢星穹铁道', keywords: ['星穹铁道'], subject: '星穹铁道' }))
    store.upsert('u1', candidate({ content: '喜欢摄影', keywords: ['摄影'], subject: '摄影' }))
    assert.equal(store.list('u1').length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('不同 user_id 相互隔离', () => {
  const { dir, store } = open()
  try {
    store.upsert('u1', candidate())
    store.upsert('u2', candidate({ content: '喜欢钓鱼', keywords: ['钓鱼'] }))
    assert.equal(store.list('u1').length, 1)
    assert.equal(store.list('u2').length, 1)
    assert.match(store.list('u1')[0]?.content ?? '', /星穹/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('敏感条目在 drop 模式下不落盘', () => {
  const { dir, store } = open({ sensitiveMode: 'drop' })
  try {
    const result = store.upsert('u1', candidate({ type: 'health', content: '对花生过敏', sensitivity: 'sensitive' }))
    assert.equal(result.action, 'skipped')
    assert.equal(store.list('u1').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('敏感条目在 encrypt 模式下密文落盘、召回取到明文', () => {
  const { dir, file, store } = open({ sensitiveMode: 'encrypt' })
  try {
    store.upsert('u1', candidate({ type: 'health', content: '对花生过敏', sensitivity: 'sensitive' }))
    const raw = readFileSync(file, 'utf8')
    assert.ok(raw.includes('enc:'), '文件里应是密文')
    assert.ok(!raw.includes('对花生过敏'), '文件里不应出现明文')
    const pool = store.recallPool('u1')
    assert.equal(pool[0]?.plain, '对花生过敏')
    assert.equal(store.list('u1')[0]?.content, '[已加密存储]')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('超过单用户上限时淘汰最久未更新的条目', () => {
  const { dir, store } = open({ max: 2 })
  try {
    store.upsert('u1', candidate({ content: '喜欢 A', keywords: ['a'], subject: 'a' }))
    store.upsert('u1', candidate({ content: '喜欢 B', keywords: ['b'], subject: 'b' }))
    store.upsert('u1', candidate({ content: '喜欢 C', keywords: ['c'], subject: 'c' }))
    assert.equal(store.list('u1').length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('删除后不再出现在列表里', () => {
  const { dir, store } = open()
  try {
    const entry = store.upsert('u1', candidate()).entry
    assert.ok(entry !== undefined)
    assert.equal(store.remove('u1', entry.id), true)
    assert.equal(store.list('u1').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('构造即读盘：外部脚本忘了调 load() 也不会清空已有记忆', () => {
  const { dir, file, store } = open()
  try {
    store.upsert('u1', candidate())
    // 模拟补写脚本：只 new 一个 store，直接写
    const scripted = new MemoryStore(file, { maxEntriesPerUser: 100, sensitiveMode: 'drop' })
    scripted.upsert('u1', candidate({ content: '喜欢喝咖啡', keywords: ['咖啡'] }))
    const reread = new MemoryStore(file, { maxEntriesPerUser: 100, sensitiveMode: 'drop' })
    assert.deepEqual(
      reread.list('u1').map((entry) => entry.content).sort((a, b) => a.localeCompare(b, 'zh')),
      ['喜欢喝咖啡', '喜欢星穹铁道'].sort((a, b) => a.localeCompare(b, 'zh')),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
