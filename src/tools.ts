/**
 * 四个记忆工具：memory_list / memory_delete / memory_clear / memory_export。
 * 工具输出一律走 JSON 文本，敏感条目只给打码内容。
 */
import { maskSensitive } from './sensitive.ts'
import { MEMORY_TYPE_LABELS, isMemoryType, type MemoryEntry } from './types.ts'
import type { MemoryConfig } from './config.ts'
import type { MemoryStore } from './store.ts'

/** 工具执行结果里的内容块。 */
type ContentBlock = { type: 'text'; text: string }

/** 注册工具所需的最小 ctx 形状（避免依赖 cordis 类型包）。 */
export interface ToolsHost {
  tools: { register(definition: unknown): unknown }
}

/** 工具依赖。 */
export interface ToolsDeps {
  store: MemoryStore
  config: MemoryConfig
  userId: () => string
}

/** 把条目转成给模型看的精简形态。 */
function present(entry: MemoryEntry, config: MemoryConfig): Record<string, unknown> {
  return {
    id: entry.id,
    type: entry.type,
    label: MEMORY_TYPE_LABELS[entry.type],
    content: maskSensitive(entry.content, config.sensitive_blacklist),
    keywords: entry.keywords,
    hits: entry.hits,
    sensitivity: entry.sensitivity,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    conflicts: entry.conflicts.map((item) => ({ content: maskSensitive(item.content, config.sensitive_blacklist), replaced_at: item.replaced_at })),
  }
}

/** 统一的结果渲染。 */
function ok(value: unknown): { content: ContentBlock[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** 通用 output 声明：纯 JSON 透传。 */
const jsonOutput = {
  schema: { type: 'object' },
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

/** 注册四个工具。 */
export function registerMemoryTools(host: ToolsHost, deps: ToolsDeps): void {
  host.tools.register({
    name: 'memory_list',
    description: '列出当前用户的长期记忆条目，可按类型（13 类之一）或关键词过滤。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'identity / personality / interest / skill / goal / life_event / preference / relationship / boundary / decision / health / resource / milestone',
        },
        keyword: { type: 'string', description: '按内容或关键词子串过滤' },
        limit: { type: 'number', description: '最多返回几条，默认 50' },
      },
      additionalProperties: false,
    },
    output: jsonOutput,
    execute: async (args: unknown) => {
      const input = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const type = isMemoryType(input.type) ? input.type : undefined
      const keyword = typeof input.keyword === 'string' ? input.keyword : undefined
      const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.round(input.limit))) : 50
      const entries = deps.store.list(deps.userId(), { ...(type === undefined ? {} : { type }), ...(keyword === undefined ? {} : { keyword }), limit })
      return ok({ total: entries.length, entries: entries.map((entry) => present(entry, deps.config)) })
    },
  })

  host.tools.register({
    name: 'memory_delete',
    description: '按 id 删除一条长期记忆（删除后不会再被召回）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'memory_list 返回的条目 id' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: jsonOutput,
    execute: async (args: unknown) => {
      const input = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const id = typeof input.id === 'string' ? input.id : ''
      if (id === '') return ok({ deleted: false, reason: 'missing id' })
      return ok({ id, deleted: deps.store.remove(deps.userId(), id) })
    },
  })

  host.tools.register({
    name: 'memory_clear',
    description: '清空当前用户的全部长期记忆，必须显式传 confirm=true。',
    parameters: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: '传 true 才会真的清空' } },
      required: ['confirm'],
      additionalProperties: false,
    },
    output: jsonOutput,
    execute: async (args: unknown) => {
      const input = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      if (input.confirm !== true) return ok({ cleared: 0, reason: 'confirm required' })
      return ok({ cleared: deps.store.clear(deps.userId()) })
    },
  })

  host.tools.register({
    name: 'memory_export',
    description: '导出当前用户的长期记忆为 JSON（用于备份或迁移）。',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string', description: '可选：导出的用户 id，默认当前用户' } },
      additionalProperties: false,
    },
    output: jsonOutput,
    execute: async (args: unknown) => {
      const input = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const userId = typeof input.user_id === 'string' && input.user_id !== '' ? input.user_id : deps.userId()
      const file = deps.store.export(userId)
      const entries = file.users[userId] ?? []
      return ok({ user_id: userId, count: entries.length, export: file })
    },
  })
}
