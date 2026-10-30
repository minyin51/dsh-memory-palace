/** 提取器单测：多类覆盖、黑名单拒写、显式指令。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from '../src/config.ts'
import { candidatesFromCommands, extractCommands, extractMemories } from '../src/extract.ts'

const config = resolveConfig({})

test('一段话能抽出多个类型', () => {
  const text = '我叫小明，我在上海读书。我喜欢星穹铁道。我想考上研究生。我性格比较内向。'
  const types = new Set(extractMemories(text, config, 's1').map((item) => item.type))
  assert.ok(types.has('identity'), '应识别身份')
  assert.ok(types.has('interest'), '应识别兴趣')
  assert.ok(types.has('goal'), '应识别目标')
  assert.ok(types.has('personality'), '应识别性格')
})

test('13 类规则覆盖到 6 类以上', () => {
  const text = [
    '我叫阿鱼。',
    '我性格比较慢热。',
    '我喜欢打游戏。',
    '我会写 TypeScript。',
    '我打算明年换工作。',
    '我习惯用 VSCode。',
    '我妈妈是医生。',
    '我讨厌被人催。',
    '我决定先不买房。',
    '我对花生过敏。',
    '我有一台台式电脑。',
    '我拿到了软考证书。',
  ].join('\n')
  const types = new Set(extractMemories(text, config).map((item) => item.type))
  assert.ok(types.size >= 6, `类型覆盖不足：${[...types].join(',')}`)
})

test('含密码的内容一律不进入候选', () => {
  const candidates = extractMemories('我的密码是 abc12345，记住我住在杭州。', config)
  assert.ok(candidates.every((item) => !item.content.includes('abc12345')))
  assert.ok(candidates.every((item) => !item.content.includes('密码')))
})

test('健康类默认被标为 sensitive', () => {
  const candidates = extractMemories('我对花生过敏。', config)
  const health = candidates.find((item) => item.type === 'health')
  assert.ok(health !== undefined)
  assert.equal(health.sensitivity, 'sensitive')
})

test('「记住这个」会被识别并转成候选', () => {
  const commands = extractCommands('记住我喜欢喝冰美式')
  assert.deepEqual(commands.remember, ['我喜欢喝冰美式'])
  const candidates = candidatesFromCommands(commands, config, 's1')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.content, '我喜欢喝冰美式')
})

test('「忘掉这个」会被识别', () => {
  const commands = extractCommands('忘掉我喜欢喝冰美式')
  assert.deepEqual(commands.forget, ['我喜欢喝冰美式'])
})

test('宠物：数量和名字都能抽出来', () => {
  const candidates = extractMemories('我喜欢猫，我家里养了两只猫，一只叫开心一只叫妙妙', config)
  const texts = candidates.map((item) => item.content)
  assert.ok(texts.includes('喜欢猫'), `缺少兴趣：${texts.join(',')}`)
  assert.ok(texts.includes('养了两只猫'), `缺少数量：${texts.join(',')}`)
  assert.ok(texts.includes('宠物叫开心'), `缺少第一只名字：${texts.join(',')}`)
  assert.ok(texts.includes('宠物叫妙妙'), `缺少第二只名字：${texts.join(',')}`)
})
