/**
 * 插件配置：默认值 + 宽松合并 + 取值钳制。
 * 所有默认值来自需求文档「五、配置默认值」；未知字段原样保留，便于前向兼容。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** score = 相似度×w1 + 频次×w2 + 时间衰减×w3。 */
export interface ScoreWeights {
  similarity: number
  frequency: number
  recency: number
}

/** 插件配置。 */
export interface MemoryConfig {
  /** 总开关；关掉后不注入、不提取、不注册工具。 */
  enabled: boolean
  /** 每轮最多注入几条。 */
  top_k: number
  /** 单次注入的 token 上限（硬上限 500）。 */
  inject_max_tokens: number
  /** 同一内容命中多少次后不再重复加日志/提示（去重阈值）。 */
  dedup_hits: number
  /** 普通记忆的时间衰减半衰期（天）。 */
  decay_days: number
  /** decision 类记忆的衰减期（决定通常更耐用）。 */
  decision_decay_days: number
  /** 三项权重。 */
  score_weights: ScoreWeights
  /** 低于该分数的候选不注入。 */
  memory_min_score: number
  /** 命中即拒写的敏感词（密码、证件号等）。 */
  sensitive_blacklist: string[]
  /** 健康类记忆默认不落盘，必须显式打开。 */
  health_memory_enabled: boolean
  /** 敏感内容落盘方式：encrypt（默认）或 plain。 */
  sensitive_storage: 'encrypt' | 'plain'
  /** 提取用的模型通道（当前实现为规则提取，保留字段）。 */
  extractor_model?: string
  /** 提取写入是否异步（turn/end 之后排队执行）。 */
  async_write: boolean
  /** 记忆文件路径；缺省 ~/.dsh/user-memory/memory.json。 */
  storage_path?: string
  /** 固定用户 id；缺省用匿名用户 id。 */
  user_id?: string
  /** 单用户条目上限，超出按分数淘汰最旧的。 */
  max_entries_per_user: number
  /** 是否输出运行日志。 */
  log: boolean
}

/** 默认配置。 */
export const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  top_k: 5,
  inject_max_tokens: 500,
  dedup_hits: 2,
  decay_days: 180,
  decision_decay_days: 720,
  score_weights: { similarity: 0.5, frequency: 0.2, recency: 0.3 },
  memory_min_score: 0.3,
  sensitive_blacklist: ['密码', '身份证', '银行卡', '验证码', '信用卡', '护照', '私钥', '助记词', 'password', 'passwd', 'secret', 'api key', 'apikey'],
  health_memory_enabled: false,
  sensitive_storage: 'encrypt',
  async_write: true,
  max_entries_per_user: 500,
  log: true,
}

/** 合法区间的钳制函数。 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 把任意输入合并进默认配置：只接受类型正确的字段，数值做区间钳制。 */
export function resolveConfig(input: unknown = {}): MemoryConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const weights = (typeof raw.score_weights === 'object' && raw.score_weights !== null ? raw.score_weights : {}) as Record<string, unknown>
  const blacklist = Array.isArray(raw.sensitive_blacklist)
    ? raw.sensitive_blacklist.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : DEFAULT_CONFIG.sensitive_blacklist
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    top_k: Math.round(clamp(raw.top_k, 1, 20, DEFAULT_CONFIG.top_k)),
    inject_max_tokens: Math.round(clamp(raw.inject_max_tokens, 50, 500, DEFAULT_CONFIG.inject_max_tokens)),
    dedup_hits: Math.round(clamp(raw.dedup_hits, 1, 20, DEFAULT_CONFIG.dedup_hits)),
    decay_days: clamp(raw.decay_days, 1, 3650, DEFAULT_CONFIG.decay_days),
    decision_decay_days: clamp(raw.decision_decay_days, 1, 3650, DEFAULT_CONFIG.decision_decay_days),
    score_weights: {
      similarity: clamp(weights.similarity, 0, 1, DEFAULT_CONFIG.score_weights.similarity),
      frequency: clamp(weights.frequency, 0, 1, DEFAULT_CONFIG.score_weights.frequency),
      recency: clamp(weights.recency, 0, 1, DEFAULT_CONFIG.score_weights.recency),
    },
    memory_min_score: clamp(raw.memory_min_score, 0, 1, DEFAULT_CONFIG.memory_min_score),
    sensitive_blacklist: blacklist.length > 0 ? blacklist : DEFAULT_CONFIG.sensitive_blacklist,
    health_memory_enabled: typeof raw.health_memory_enabled === 'boolean' ? raw.health_memory_enabled : DEFAULT_CONFIG.health_memory_enabled,
    sensitive_storage: raw.sensitive_storage === 'plain' ? 'plain' : 'encrypt',
    extractor_model: typeof raw.extractor_model === 'string' && raw.extractor_model !== '' ? raw.extractor_model : undefined,
    async_write: typeof raw.async_write === 'boolean' ? raw.async_write : DEFAULT_CONFIG.async_write,
    storage_path: typeof raw.storage_path === 'string' && raw.storage_path !== '' ? raw.storage_path : undefined,
    user_id: typeof raw.user_id === 'string' && raw.user_id !== '' ? raw.user_id : undefined,
    max_entries_per_user: Math.round(clamp(raw.max_entries_per_user, 10, 10000, DEFAULT_CONFIG.max_entries_per_user)),
    log: typeof raw.log === 'boolean' ? raw.log : DEFAULT_CONFIG.log,
  }
}

/** 记忆文件默认位置：~/.dsh/user-memory/memory.json（可用 DSH_USER_MEMORY_PATH 覆盖）。 */
export function defaultStoragePath(): string {
  const fromEnv = process.env.DSH_USER_MEMORY_PATH
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh', 'user-memory', 'memory.json')
}

/** 真正使用的存储路径。 */
export function storagePathOf(config: MemoryConfig): string {
  return config.storage_path ?? defaultStoragePath()
}
