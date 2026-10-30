/**
 * 记忆条目的类型枚举。
 * 与需求文档 4.1 的 13 类一一对应；新增类型时同步更新 MEMORY_TYPE_LABELS，
 * 否则召回/工具展示会退化成裸 type 名。
 */
export const MEMORY_TYPES = [
  'identity',
  'personality',
  'interest',
  'skill',
  'goal',
  'life_event',
  'preference',
  'relationship',
  'boundary',
  'decision',
  'health',
  'resource',
  'milestone',
] as const

/** 13 类记忆的类型字面量。 */
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** 类型的中文标签，注入与工具输出时用。 */
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  identity: '身份',
  personality: '性格',
  interest: '兴趣',
  skill: '技能',
  goal: '目标',
  life_event: '生活事件',
  preference: '偏好',
  relationship: '关系',
  boundary: '边界',
  decision: '决定',
  health: '健康',
  resource: '资源',
  milestone: '里程碑',
}

/** 是否为合法的 13 类之一。 */
export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value)
}

/** 敏感度：sensitive 默认不落盘、不注入原文。 */
export type Sensitivity = 'normal' | 'sensitive'

/** 被新版本覆盖掉的旧内容快照。 */
export interface ConflictRecord {
  /** 旧内容原文。 */
  content: string
  /** 旧条目的关键词。 */
  keywords: string[]
  /** 被覆盖的时间（ISO 8601）。 */
  replaced_at: string
  /** 旧内容来源会话。 */
  source_session?: string
  /** 旧内容在此之前累计命中的次数。 */
  hits: number
}

/** 一条记忆。 */
export interface MemoryEntry {
  /** 稳定 id，形如 mem_<random>，删除/引用都用它。 */
  id: string
  /** 13 类之一。 */
  type: MemoryType
  /** 内容，一句话。 */
  content: string
  /** 主体键（同型同主体才算冲突），缺省时由关键词首个元素退化而来。 */
  subject?: string
  /** 关键词，用于检索与相似度。 */
  keywords: string[]
  /** 首次写入时间。 */
  created_at: string
  /** 最后一次内容变更时间。 */
  updated_at: string
  /** 最后一次被召回/命中的时间。 */
  last_hit_at?: string
  /** 来源会话 id。 */
  source_session?: string
  /** 命中次数（重复写入只累加，不新增条目）。 */
  hits: number
  /** 敏感度。 */
  sensitivity: Sensitivity
  /** 归属用户。 */
  user_id: string
  /** 被覆盖的历史版本，最新版本在 content 里。 */
  conflicts: ConflictRecord[]
  /** 内容是否已加密落盘（sensitive + sensitive_storage=encrypt 时为 true）。 */
  encrypted?: boolean
}

/** 提取阶段产出的候选记忆（尚未入库）。 */
export interface MemoryCandidate {
  type: MemoryType
  content: string
  keywords: string[]
  subject?: string
  /** 重要性 0..1。 */
  importance: number
  /** 稳定性 0..1。 */
  stability: number
  sensitivity: Sensitivity
  source_session?: string
}

/** 落盘文件的整体结构：users 下按 user_id 分键，天然多用户隔离。 */
export interface MemoryFile {
  version: 1
  /** 最近一次写入时间。 */
  updated_at: string
  users: Record<string, MemoryEntry[]>
}

/** 入库结果。 */
export type UpsertAction = 'added' | 'merged' | 'overwritten' | 'skipped'

/** 入库结果明细，写日志用。 */
export interface UpsertResult {
  action: UpsertAction
  entry?: MemoryEntry
  /** action=skipped 时的原因。 */
  reason?: string
}
