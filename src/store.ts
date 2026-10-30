/**
 * 存储层：单文件 JSON，按 user_id 分键。
 * - 只写增量：同内容再出现只累加 hits；
 * - 冲突覆盖：同类型同主体且内容矛盾时，新内容覆盖旧内容，旧内容进 conflicts；
 * - 敏感内容：drop（默认不落盘）/ encrypt（AES-256-GCM 落盘）/ plain。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hasReplacementMarker, jaccard } from './text.ts'
import type { ConflictRecord, MemoryCandidate, MemoryEntry, MemoryFile, MemoryType, Sensitivity, UpsertResult } from './types.ts'

/** 敏感内容的落盘策略。 */
export type SensitiveMode = 'drop' | 'encrypt' | 'plain'

/** 存储选项。 */
export interface StoreOptions {
  /** 单用户条目上限，超出后淘汰最久未更新的。 */
  maxEntriesPerUser: number
  /** 敏感内容策略。 */
  sensitiveMode: SensitiveMode
}

/** 这些类型同一主体只保留一个版本（身份、性格、健康状况）。 */
const SINGLETON_TYPES = new Set<MemoryType>(['identity', 'personality', 'health'])

/** 内存里解出来的条目（加密条目在内存中是明文，落盘时再加密）。 */
interface StoredEntry extends MemoryEntry {
  /** 明文缓存：加密条目读出后放这里，save 时再写回 content。 */
  plain?: string
}

/** 内存里的库形态：users 里是 StoredEntry（带明文缓存），落盘前剔除。 */
interface MemoryData {
  version: 1
  updated_at: string
  users: Record<string, StoredEntry[]>
}

/** 生成条目 id。 */
function newId(): string {
  return `mem_${randomBytes(6).toString('hex')}`
}

/** 主体键：显式 subject 优先，否则退化为第一个关键词。 */
function subjectKeyOf(entry: { subject?: string; keywords: string[] }): string {
  return entry.subject ?? entry.keywords[0] ?? ''
}

/** 记忆库。 */
export class MemoryStore {
  private data: MemoryData = { version: 1, updated_at: '', users: {} }
  private key: Buffer | null = null
  private readonly file: string
  private readonly options: StoreOptions

  constructor(file: string, options: StoreOptions) {
    this.file = file
    this.options = options
    // 构造即读盘：外部脚本（补写、导出）很容易忘记调 load()，忘了就会拿空库覆盖真文件。
    // 读失败不在这里抛，留给显式 load() 去报错和处理（插件会备份坏文件后重建）。
    try {
      this.load()
    } catch (error) {
      this.loadFailure = error
    }
  }

  /** 构造时读盘失败的原因；显式 load() 会把它抛出来。 */
  private loadFailure: unknown = null

  /** 从磁盘读取；文件不存在时视为空库（并在首次写入时创建）。 */
  load(): void {
    if (this.loadFailure !== null) {
      const failure = this.loadFailure
      this.loadFailure = null
      throw failure
    }
    if (!existsSync(this.file)) {
      this.data = { version: 1, updated_at: new Date().toISOString(), users: {} }
      return
    }
    const text = readFileSync(this.file, 'utf8')
    const parsed = JSON.parse(text) as MemoryFile
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== 1 || typeof parsed.users !== 'object' || parsed.users === null) {
      throw new Error(`记忆文件格式不正确: ${this.file}`)
    }
    this.data = { version: 1, updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date().toISOString(), users: parsed.users }
    this.decryptAll()
  }

  /** 原子写盘（先写 .tmp 再 rename），避免半截文件；`plain` 是内存缓存，绝不落盘。 */
  save(): void {
    this.encryptAll()
    this.data.updated_at = new Date().toISOString()
    mkdirSync(dirname(this.file), { recursive: true })
    const users: Record<string, MemoryEntry[]> = {}
    for (const [key, bucket] of Object.entries(this.data.users)) {
      users[key] = (bucket as StoredEntry[]).map((entry) => {
        const { plain: _plain, ...rest } = entry
        return rest
      })
    }
    const snapshot: MemoryFile = { version: 1, updated_at: this.data.updated_at, users }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
    renameSync(tmp, this.file)
    this.decryptAll()
  }

  /** 某用户的全部条目（按更新时间倒序）。 */
  entries(userId: string): StoredEntry[] {
    const list = this.data.users[userId] ?? []
    return [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }

  /** 查询。 */
  list(
    userId: string,
    filter: { type?: MemoryType; keyword?: string; limit?: number } = {},
  ): MemoryEntry[] {
    let list = this.entries(userId)
    if (filter.type !== undefined) list = list.filter((entry) => entry.type === filter.type)
    if (filter.keyword !== undefined && filter.keyword !== '') {
      const needle = filter.keyword
      list = list.filter((entry) => (entry.plain ?? entry.content).includes(needle) || entry.keywords.includes(needle))
    }
    const limit = filter.limit ?? 100
    return list.slice(0, limit).map((entry) => this.toPublic(entry))
  }

  /** 按 id 取一条。 */
  get(userId: string, id: string): MemoryEntry | undefined {
    const entry = this.entries(userId).find((item) => item.id === id)
    return entry === undefined ? undefined : this.toPublic(entry)
  }

  /**
   * 写入一条候选记忆。
   * 规则：重复内容 → 只加 hits；同主体矛盾 → 覆盖并把旧内容压进 conflicts；其余新增。
   */
  upsert(userId: string, candidate: MemoryCandidate): UpsertResult {
    if (candidate.sensitivity === 'sensitive' && this.options.sensitiveMode === 'drop') {
      return { action: 'skipped', reason: 'sensitive-disabled' }
    }
    const content = candidate.content
    if (content.trim() === '') return { action: 'skipped', reason: 'empty' }

    const users = this.data.users
    const bucket = users[userId] ?? (users[userId] = [])
    const key = subjectKeyOf(candidate)
    const sameSubject = bucket.filter((entry) => entry.type === candidate.type && subjectKeyOf(entry) === key)
    const now = new Date().toISOString()

    // 1) 同一个内容再次出现：只累加 hits，不新增条目
    const duplicate = sameSubject.find((entry) => jaccard(entry.plain ?? entry.content, content) >= 0.8)
    if (duplicate !== undefined) {
      duplicate.hits += 1
      duplicate.last_hit_at = now
      this.save()
      return { action: 'merged', entry: this.toPublic(duplicate) }
    }

    // 2) 同主体但内容不同：口风变了（有改口标记）或该类型只留一个版本 → 覆盖
    const target = sameSubject[0]
    if (target !== undefined && (hasReplacementMarker(content) || SINGLETON_TYPES.has(candidate.type))) {
      const conflict: ConflictRecord = {
        content: target.plain ?? target.content,
        keywords: [...target.keywords],
        replaced_at: now,
        source_session: target.source_session,
        hits: target.hits,
      }
      target.conflicts = [...target.conflicts, conflict]
      target.content = content
      target.plain = content
      target.encrypted = false
      target.keywords = [...candidate.keywords]
      target.subject = candidate.subject ?? target.subject
      target.updated_at = now
      target.last_hit_at = now
      target.hits += 1
      target.sensitivity = candidate.sensitivity
      this.enforceLimit(userId)
      this.save()
      return { action: 'overwritten', entry: this.toPublic(target) }
    }

    // 3) 新条目
    const entry: StoredEntry = {
      id: newId(),
      type: candidate.type,
      content,
      plain: content,
      ...(candidate.subject === undefined ? {} : { subject: candidate.subject }),
      keywords: [...candidate.keywords],
      created_at: now,
      updated_at: now,
      last_hit_at: now,
      ...(candidate.source_session === undefined ? {} : { source_session: candidate.source_session }),
      hits: 1,
      sensitivity: candidate.sensitivity,
      user_id: userId,
      conflicts: [],
    }
    bucket.push(entry)
    this.enforceLimit(userId)
    this.save()
    return { action: 'added', entry: this.toPublic(entry) }
  }

  /** 删除一条，返回是否删到。 */
  remove(userId: string, id: string): boolean {
    const bucket = this.data.users[userId]
    if (bucket === undefined) return false
    const index = bucket.findIndex((entry) => entry.id === id)
    if (index < 0) return false
    bucket.splice(index, 1)
    this.save()
    return true
  }

  /** 清空某用户（或全部用户）。 */
  clear(userId?: string): number {
    if (userId === undefined) {
      let removed = 0
      for (const key of Object.keys(this.data.users)) {
        removed += this.data.users[key]?.length ?? 0
        delete this.data.users[key]
      }
      this.save()
      return removed
    }
    const removed = this.data.users[userId]?.length ?? 0
    delete this.data.users[userId]
    this.save()
    return removed
  }

  /** 导出（默认导出当前用户；不传 user_id 时导出全库）。 */
  export(userId?: string): MemoryFile {
    if (userId === undefined) return { ...this.data, users: { ...this.data.users } }
    const entries = this.entries(userId).map((entry) => this.toPublic(entry))
    return { version: 1, updated_at: new Date().toISOString(), users: { [userId]: entries } }
  }

  /** 供召回使用的明文副本（不暴露加密态）。 */
  recallPool(userId: string): Array<MemoryEntry & { plain: string }> {
    return this.entries(userId).map((entry) => ({ ...this.toPublic(entry), plain: entry.plain ?? entry.content }))
  }

  /** 超出上限时按最后更新时间淘汰。 */
  private enforceLimit(userId: string): void {
    const bucket = this.data.users[userId]
    if (bucket === undefined) return
    const limit = this.options.maxEntriesPerUser
    if (bucket.length <= limit) return
    bucket.sort((a, b) => (b.last_hit_at ?? b.updated_at).localeCompare(a.last_hit_at ?? a.updated_at))
    bucket.splice(limit)
  }

  /** 对外形态：加密条目只给打码内容。 */
  private toPublic(entry: StoredEntry): MemoryEntry {
    const copy: MemoryEntry = { ...entry }
    delete (copy as StoredEntry).plain
    if (entry.encrypted === true) copy.content = '[已加密存储]'
    return copy
  }

  /** 加密密钥：与记忆文件同目录的 memory.key（不存在则生成 0600 权限）。 */
  private encryptionKey(): Buffer {
    if (this.key !== null) return this.key
    const keyFile = join(dirname(this.file), 'memory.key')
    if (!existsSync(keyFile)) {
      mkdirSync(dirname(keyFile), { recursive: true })
      writeFileSync(keyFile, randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600 })
    }
    this.key = scryptSync(readFileSync(keyFile, 'utf8').trim(), 'dsh-user-memory', 32)
    return this.key
  }

  /** 敏感条目：落盘前加密。 */
  private encryptAll(): void {
    if (this.options.sensitiveMode !== 'encrypt') return
    for (const bucket of Object.values(this.data.users)) {
      for (const entry of bucket as StoredEntry[]) {
        if (entry.sensitivity !== 'sensitive' || entry.encrypted === true) continue
        const plain = entry.plain ?? entry.content
        entry.content = this.encrypt(plain)
        entry.encrypted = true
      }
    }
  }

  /** 敏感条目：读出后解密到内存。 */
  private decryptAll(): void {
    for (const bucket of Object.values(this.data.users)) {
      for (const entry of bucket as StoredEntry[]) {
        if (entry.encrypted !== true) continue
        try {
          entry.plain = this.decrypt(entry.content)
        } catch {
          entry.plain = '[解密失败]'
        }
      }
    }
  }

  /** AES-256-GCM：iv(12) + tag(16) + 密文，base64 编码。 */
  private encrypt(plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return `enc:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
  }

  /** 解密。 */
  private decrypt(payload: string): string {
    if (!payload.startsWith('enc:')) return payload
    const raw = Buffer.from(payload.slice(4), 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const body = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }
}

/** 判断敏感度是否需要特殊处理。 */
export function isSensitive(sensitivity: Sensitivity): boolean {
  return sensitivity === 'sensitive'
}
