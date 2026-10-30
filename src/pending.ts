/**
 * 待写入文本的落盘缓存。
 *
 * 为什么需要它：一轮的用户文本在 pre-step 捕获、turn/end 才写入。
 * 中间如果插件被热重载/进程退出，内存里的 Map 就没了，这一轮的记忆会静默丢失
 * （2026-10-30 04:37 那次换目录重载就丢过一轮）。
 * 所以这里把 Map 同步落到一个小 JSON 文件里，apply() 时再读回来。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** 从磁盘读回上次没来得及写入的文本；读坏了就当成空。 */
export function loadPending(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  try {
    if (!existsSync(file)) return map
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return map
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const texts = value.filter((item): item is string => typeof item === 'string' && item !== '')
      if (texts.length > 0) map.set(sessionId, texts)
    }
  } catch {
    return new Map()
  }
  return map
}

/** 把当前待写入状态写回磁盘（内容很小，直接同步写）。 */
export function savePending(file: string, map: Map<string, string[]>): void {
  try {
    const plain: Record<string, string[]> = {}
    for (const [sessionId, texts] of map) {
      if (texts.length > 0) plain[sessionId] = texts
    }
    writeFileSync(file, JSON.stringify(plain), 'utf8')
  } catch {
    // 落盘失败不影响主流程，下次 pre-step 还会再写一遍。
  }
}
