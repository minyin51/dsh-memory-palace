/**
 * dsh-memory-palace —— 给 DeepSeek Harness 的长期用户记忆。
 *
 * 一轮对话里做三件事：
 *   1. 用户消息进入模型前（agent/pre-step）：按分数召回 top_k 条记忆，塞进 system prompt 的 <memory> 段；
 *   2. 一轮结束（turn/end）：异步把这一轮用户说的话交给规则提取器，增量写库（去重 / 冲突覆盖）；
 *   3. 常驻：注册 memory_list / memory_delete / memory_clear / memory_export 四个工具。
 *
 * 任何一步失败都只记日志，不影响对话本身。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveConfig, storagePathOf, type MemoryConfig } from './config.ts'
import { candidatesFromCommands, extractCommands, extractMemories } from './extract.ts'
import { recall } from './recall.ts'
import { loadPending, savePending } from './pending.ts'
import { MemoryStore } from './store.ts'
import { registerMemoryTools } from './tools.ts'

/** 插件名，与 package.json / cordis.patch.yml 保持一致。 */
export const name = 'dsh-memory-palace'

/** 依赖的宿主服务。 */
export const inject = ['systemPrompt', 'tools']

/** 宿主 ctx 的最小形状（只写用得到的部分，避免依赖 cordis 类型包）。 */
interface PluginContext {
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  systemPrompt?: { section(definition: { name: string; order?: number; text: string | (() => string); interpolate?: boolean }): unknown }
  tools?: { register(definition: unknown): unknown }
  inject?(services: string[], callback: (ctx: PluginContext) => void): () => void
  on?(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): () => void
}

/** 记忆文件同目录的审计日志。 */
function auditPathOf(storagePath: string): string {
  return join(dirname(storagePath), 'events.jsonl')
}

/** 匿名用户 id：优先用 DSH 的匿名 id 包，退化成自管文件。 */
async function resolveUserId(explicit?: string): Promise<string> {
  if (explicit !== undefined) return explicit
  try {
    // 宿主装了 @deepseek-ai/dsh-anonymous-user-id 时直接用它的实现（包名是常量，运行时才解析）
    const specifier: string = '@deepseek-ai/dsh-anonymous-user-id'
    const mod = (await import(specifier)) as { getOrCreateAnonymousUserId?: (home?: string) => Promise<string> | string }
    const value = await mod.getOrCreateAnonymousUserId?.()
    if (typeof value === 'string' && value !== '') return value
  } catch {
    // 没有这个包就走下面的兜底
  }
  const file = join(homedir(), '.dsh', 'user-memory', '.user-id')
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim()
      if (existing !== '') return existing
    }
    const generated = `local-${Math.random().toString(36).slice(2, 10)}`
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 })
    return generated
  } catch {
    return 'local'
  }
}

/** 从消息里抽纯文本：兼容 string / content blocks / parts 三种形态。 */
function messageText(message: unknown): string {
  const item = (typeof message === 'object' && message !== null ? message : {}) as Record<string, unknown>
  const content = item.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        const part = (typeof block === 'object' && block !== null ? block : {}) as Record<string, unknown>
        return typeof part.text === 'string' ? part.text : ''
      })
      .join('\n')
  }
  if (Array.isArray(item.parts)) {
    return item.parts.map((part) => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? String((part as { text: string }).text) : '')).join('\n')
  }
  return ''
}

/** 取最后一条用户消息的正文，并剥掉宿主注入的系统提醒。 */
function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined
    if (message === undefined || message === null) continue
    const role = message.role ?? (message as { source?: { kind?: string } }).source?.kind
    if (role !== 'user' && role !== 'human') continue
    const text = messageText(message).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
    if (text !== '') return text
  }
  return ''
}

/** 从 pre-step 的 payload 里取会话 id。 */
function sessionIdOf(payload: unknown): string {
  const root = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const candidates = [
    (root.session as { id?: unknown } | undefined)?.id,
    (root.agent as { session?: { id?: unknown } } | undefined)?.session?.id,
    (root.agent as { id?: unknown } | undefined)?.id,
  ]
  for (const value of candidates) if (typeof value === 'string' && value !== '') return value
  return 'unknown'
}

/** 插件入口。 */
export async function apply(ctx: PluginContext, rawConfig: unknown): Promise<void> {
  const config: MemoryConfig = resolveConfig(rawConfig)
  const log = (level: 'info' | 'warn', message: string): void => {
    if (!config.log) return
    try {
      ctx.logger?.[level]?.(`[user-memory] ${message}`)
    } catch {
      // 日志失败不影响主流程
    }
  }
  if (!config.enabled) {
    log('info', '已禁用（enabled=false），不注入、不提取、不注册工具')
    return
  }

  const storagePath = storagePathOf(config)
  const auditPath = auditPathOf(storagePath)
  const store = new MemoryStore(storagePath, {
    maxEntriesPerUser: config.max_entries_per_user,
    sensitiveMode: config.health_memory_enabled ? (config.sensitive_storage === 'plain' ? 'plain' : 'encrypt') : 'drop',
  })
  try {
    store.load()
  } catch (error) {
    // 文件坏了不能让插件把 DSH 拖挂：备份后从空库开始
    try {
      renameSync(storagePath, `${storagePath}.broken-${Date.now()}`)
    } catch {
      // 备份失败也继续
    }
    log('warn', `记忆文件读取失败，已备份并重建：${String(error)}`)
    store.load()
  }

  // 记下本次加载时间，方便排查「代码改了却没生效」——插件是加载时快照，改完要重启或重新加载
  try {
    mkdirSync(dirname(storagePath), { recursive: true })
    writeFileSync(join(dirname(storagePath), '.boot.json'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
  } catch {
    // 只是诊断信息，写不进去不影响主流程
  }

  const userId = await resolveUserId(config.user_id)

  /** 审计日志：每轮写入/注入都留痕，含 token 数与条目 id。 */
  const audit = (record: Record<string, unknown>): void => {
    try {
      mkdirSync(dirname(auditPath), { recursive: true })
      appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), user_id: userId, ...record })}\n`, 'utf8')
    } catch {
      // 审计写不进去不影响主流程
    }
  }

  // 当前这一轮要注入的文本：pre-step 算出来，systemPrompt 段每次取最新值
  let injection = ''
  let lastInjectedIds: string[] = []

  /** 一轮里用户说过的话，turn/end 时统一提取；同时落盘，热重载后还能补写。 */
  const pendingFile = join(dirname(storagePath), '.pending.json')
  const pendingBySession = loadPending(pendingFile)

  /** 这一轮的用户文本 → 提取 → 增量入库。 */
  const ingest = (sessionId: string, texts: string[]): void => {
    const joined = texts.join('\n')
    const commands = extractCommands(joined)
    const candidates = [...extractMemories(joined, config, sessionId), ...candidatesFromCommands(commands, config, sessionId)]
    let added = 0
    let merged = 0
    let overwritten = 0
    let skipped = 0
    const ids: string[] = []
    for (const candidate of candidates) {
      const result = store.upsert(userId, candidate)
      if (result.action === 'added') added += 1
      else if (result.action === 'merged') merged += 1
      else if (result.action === 'overwritten') overwritten += 1
      else skipped += 1
      if (result.entry !== undefined) ids.push(result.entry.id)
    }
    // 「忘掉这个」：按内容子串删
    let forgotten = 0
    for (const phrase of commands.forget) {
      for (const entry of store.list(userId, { keyword: phrase, limit: 20 })) {
        if (store.remove(userId, entry.id)) forgotten += 1
      }
    }
    audit({ kind: 'write', session: sessionId, candidates: candidates.length, added, merged, overwritten, skipped, forgotten, ids })
    if (candidates.length > 0) log('info', `提取 ${candidates.length} 条：新增 ${added}，合并 ${merged}，覆盖 ${overwritten}，丢弃 ${skipped}，忘记 ${forgotten}`)
  }

  /**
   * 安排一次写入：默认下一轮事件循环再跑，避免拖慢对话。
   * 抽成函数是为了让 turn/end 和「补写上一轮」共用同一套容错。
   */
  const scheduleIngest = (sessionId: string, texts: string[]): void => {
    const run = (): void => {
      try {
        ingest(sessionId, texts)
      } catch (error) {
        log('warn', `写入记忆失败：${String(error)}`)
      }
    }
    if (config.async_write) setImmediate(run)
    else run()
  }

  // ① 召回注入
  try {
    const registerSection = (target: PluginContext): void => {
      const systemPrompt = target.systemPrompt
      if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
        log('warn', '宿主未提供 systemPrompt 服务，只做写入不注入')
        return
      }
      systemPrompt.section({
        name: 'user-memory',
        order: 90,
        text: () => injection,
        interpolate: false,
      })
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['systemPrompt'], (scoped) => {
        try {
          registerSection(scoped)
        } catch (error) {
          log('warn', `注册 systemPrompt 段失败：${String(error)}`)
        }
      })
    } else {
      registerSection(ctx)
    }

    ctx.on?.(
      'agent/pre-step',
      async (payload: unknown, next: () => Promise<unknown>) => {
        try {
          const text = lastUserText((payload as { messages?: unknown } | undefined)?.messages)
          if (text !== '') {
            const sessionId = sessionIdOf(payload)
            // 上一轮如果没等到 turn/end（插件热重载、进程被杀），这里补写，避免整轮记忆丢失。
            const leftover = pendingBySession.get(sessionId)
            if (leftover !== undefined && leftover.length > 0) {
              pendingBySession.delete(sessionId)
              savePending(pendingFile, pendingBySession)
              log('info', `补写上一轮 ${leftover.length} 段文本`)
              scheduleIngest(sessionId, leftover)
            }
            const queue = pendingBySession.get(sessionId) ?? []
            queue.push(text)
            pendingBySession.set(sessionId, queue)
            savePending(pendingFile, pendingBySession)

            const result = recall(store.recallPool(userId), text, config)
            injection = result.text
            lastInjectedIds = result.entries.map((item) => item.entry.id)
            audit({ kind: 'inject', session: sessionId, tokens: result.tokens, ids: lastInjectedIds, candidates: result.entries.length })
            if (result.tokens > 0) log('info', `注入 ${result.entries.length} 条 / ${result.tokens} token：${lastInjectedIds.join(',')}`)
          }
        } catch (error) {
          log('warn', `召回失败：${String(error)}`)
        }
        return next()
      },
      { prepend: true },
    )
  } catch (error) {
    log('warn', `挂载召回钩子失败：${String(error)}`)
  }

  // ② 轮末提取（异步，不阻塞对话）
  try {
    ctx.on?.('session/event', (...args: unknown[]) => {
      const session = args[0] as { id?: unknown } | undefined
      const event = args[1] as { type?: unknown } | undefined
      if (event?.type !== 'turn/end') return
      const sessionId = typeof session?.id === 'string' && session.id !== '' ? session.id : 'unknown'
      const texts = pendingBySession.get(sessionId)
      pendingBySession.delete(sessionId)
      savePending(pendingFile, pendingBySession)
      if (texts === undefined || texts.length === 0) return
      scheduleIngest(sessionId, texts)
    })
  } catch (error) {
    log('warn', `挂载轮末钩子失败：${String(error)}`)
  }

  // ③ 四个工具
  try {
    if (ctx.tools !== undefined && typeof ctx.tools.register === 'function') {
      registerMemoryTools({ tools: ctx.tools }, { store, config, userId: () => userId })
    } else {
      log('warn', '宿主未提供 tools 服务，跳过工具注册')
    }
  } catch (error) {
    log('warn', `注册工具失败：${String(error)}`)
  }

  log('info', `已加载：${storagePath}（user=${userId}，top_k=${config.top_k}，inject_max_tokens=${config.inject_max_tokens}）`)
}
