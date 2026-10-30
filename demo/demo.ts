/**
 * 可运行的演示：多轮对话 → 重启 → 召回验证。
 *
 *   node demo/demo.ts
 *
 * 不连真实模型，只把「提取 → 入库 → 召回 → 注入」这条链路走一遍，
 * 每轮打印注入给模型的那段 <memory>，以及库里条目的变化。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { candidatesFromCommands, extractCommands, extractMemories } from '../src/extract.ts'
import { recall } from '../src/recall.ts'
import { MemoryStore } from '../src/store.ts'

const config = resolveConfig({ log: false })
const dir = mkdtempSync(join(tmpdir(), 'dsh-user-memory-demo-'))
const file = join(dir, 'memory.json')
const userId = 'demo-user'

/** 开库（模拟一次进程启动）。 */
function open(): MemoryStore {
  const store = new MemoryStore(file, { maxEntriesPerUser: config.max_entries_per_user, sensitiveMode: 'drop' })
  store.load()
  return store
}

/** 一轮：召回 → 回答 → 轮末提取。 */
function turn(store: MemoryStore, index: number, userText: string): void {
  console.log(`\n──────── 第 ${index} 轮 ────────`)
  console.log(`用户：${userText}`)

  const recalled = recall(store.recallPool(userId), userText, config)
  console.log(`注入 ${recalled.entries.length} 条 / ${recalled.tokens} token：`)
  console.log(recalled.text === '' ? '（空，不注入）' : recalled.text)

  const commands = extractCommands(userText)
  const candidates = [...extractMemories(userText, config, `s${index}`), ...candidatesFromCommands(commands, config, `s${index}`)]
  const actions: string[] = []
  for (const candidate of candidates) {
    const result = store.upsert(userId, candidate)
    if (result.action !== 'skipped') actions.push(`${result.action}:${candidate.type}:${candidate.content}`)
  }
  for (const phrase of commands.forget) {
    for (const entry of store.list(userId, { keyword: phrase, limit: 20 })) store.remove(userId, entry.id)
  }
  console.log(actions.length === 0 ? '本轮没有值得记的' : `入库：${actions.join(' | ')}`)
}

const first = open()
turn(first, 1, '我叫小明，在杭州做前端。我喜欢星穹铁道。')
turn(first, 2, '我性格比较内向，不太会主动找人聊天。')
turn(first, 3, '我习惯用 VSCode。')
turn(first, 4, '我喜欢星穹铁道。')
turn(first, 5, '我现在改用 JetBrains 了。')
turn(first, 6, '记住我不吃香菜。')
turn(first, 7, '我的密码是 hunter2，别记这个。')
turn(first, 8, '忘掉我不吃香菜。')

console.log('\n──────── 重启（重新建库实例） ────────')
const second = open()
const types = new Set(second.list(userId).map((entry) => entry.type))
console.log(`重启后仍有 ${second.list(userId).length} 条记忆，覆盖 ${types.size} 类：${[...types].join(', ')}`)

const afterRestart = recall(second.recallPool(userId), '你还记得我住哪、喜欢什么吗？', config)
console.log(`\n重启后注入 ${afterRestart.entries.length} 条 / ${afterRestart.tokens} token：`)
console.log(afterRestart.text)

console.log('\n──────── 最终库存 ────────')
for (const entry of second.list(userId)) {
  console.log(`- [${entry.type}] ${entry.content}（hits=${entry.hits}，conflicts=${entry.conflicts.length}）`)
}

rmSync(dir, { recursive: true, force: true })
