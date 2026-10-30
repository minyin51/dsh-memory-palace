/** 四个工具的单测：注册、列表、删除、清空、导出。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryTools, type ToolsHost } from '../src/tools.ts'
import type { MemoryCandidate } from '../src/types.ts'

/** 收集注册出来的工具定义。 */
function setup(): { names: string[]; call: (name: string, args: unknown) => Promise<unknown>; store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-user-memory-tools-'))
  const store = new MemoryStore(join(dir, 'memory.json'), { maxEntriesPerUser: 100, sensitiveMode: 'drop' })
  store.load()
  const defs = new Map<string, { execute: (args: unknown) => Promise<unknown> }>()
  const host: ToolsHost = {
    tools: {
      register(definition: unknown): unknown {
        const item = definition as { name: string; execute: (args: unknown) => Promise<unknown> }
        defs.set(item.name, item)
        return () => undefined
      },
    },
  }
  registerMemoryTools(host, { store, config: resolveConfig({}), userId: () => 'u1' })
  return {
    names: [...defs.keys()],
    call: async (name: string, args: unknown) => {
      const def = defs.get(name)
      return def === undefined ? undefined : def.execute(args)
    },
    store,
    dir,
  }
}

/** 从工具返回里取出 JSON。 */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>
}

/** 造一条记忆。 */
function seed(store: MemoryStore): void {
  const candidate: MemoryCandidate = {
    type: 'interest',
    content: '喜欢星穹铁道',
    keywords: ['星穹铁道'],
    importance: 0.6,
    stability: 0.7,
    sensitivity: 'normal',
  }
  store.upsert('u1', candidate)
}

test('四个工具都注册了', () => {
  const { names, dir } = setup()
  try {
    assert.deepEqual(names.sort(), ['memory_clear', 'memory_delete', 'memory_export', 'memory_list'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory_list 能列出条目', async () => {
  const { store, call, dir } = setup()
  try {
    seed(store)
    const result = payload(await call('memory_list', {}))
    assert.equal(result.total, 1)
    const entries = result.entries as Array<{ content: string }>
    assert.match(entries[0]?.content ?? '', /星穹铁道/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory_delete 删除后列表为空', async () => {
  const { store, call, dir } = setup()
  try {
    seed(store)
    const id = store.list('u1')[0]?.id ?? ''
    const deleted = payload(await call('memory_delete', { id }))
    assert.equal(deleted.deleted, true)
    assert.equal(payload(await call('memory_list', {})).total, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory_clear 需要 confirm', async () => {
  const { store, call, dir } = setup()
  try {
    seed(store)
    assert.equal(payload(await call('memory_clear', {})).cleared, 0)
    assert.equal(payload(await call('memory_clear', { confirm: true })).cleared, 1)
    assert.equal(payload(await call('memory_list', {})).total, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory_export 返回可再导入的结构', async () => {
  const { store, call, dir } = setup()
  try {
    seed(store)
    const result = payload(await call('memory_export', {}))
    assert.equal(result.count, 1)
    const dump = result.export as { version: number; users: Record<string, unknown[]> }
    assert.equal(dump.version, 1)
    assert.equal(dump.users.u1?.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
