/**
 * 记忆文本清洗：去语气词 / 取重点分句 / 去连接虚词。
 * 这三步决定「记下来的那句话」长什么样，改规则必须先改这里。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { keyPhrase, stripConnectives, stripParticles } from '../src/text.ts'
import { cleanContent } from '../src/text.ts'

test('句子开头的口语停顿被去掉', () => {
  assert.equal(stripParticles('嗯，我喜欢咖啡'), '我喜欢咖啡')
  assert.equal(stripParticles('那个其实我在杭州工作'), '我在杭州工作')
})

test('句末语气词被去掉（含叠用与波浪号）', () => {
  assert.equal(stripParticles('我喜欢咖啡吧'), '我喜欢咖啡')
  assert.equal(stripParticles('好的呀～'), '好的')
  assert.equal(stripParticles('是这样呢'), '是这样')
})

test('分句结尾的语气词被去掉', () => {
  assert.equal(stripParticles('我喜欢咖啡吧，你呢'), '我喜欢咖啡，你')
})

test('「的 / 是」这类连接虚词被去掉', () => {
  assert.equal(stripConnectives('名字是小明'), '名字小明')
  assert.equal(stripConnectives('我的猫叫团子'), '我猫叫团子')
  assert.equal(stripConnectives('身份是前端工程师'), '身份前端工程师')
})

test('含「的是」的固定词不被拆坏', () => {
  assert.equal(stripConnectives('但是我还是喜欢这个'), '但是我还是喜欢这个')
  assert.equal(stripConnectives('目的很明确'), '目的很明确')
  assert.equal(stripConnectives('的话我就去'), '的话我就去')
})

test('多分句时按信息量挑出重点', () => {
  assert.equal(keyPhrase('我喜欢咖啡，不过其实更喜欢茶'), '不过其实更喜欢茶')
  assert.equal(keyPhrase('好的'), '好的')
  // 重点分句太短时退回整句，避免丢信息
  assert.equal(keyPhrase('我在杭州，嗯，做前端'), '我在杭州，嗯，做前端')
})

test('cleanContent 把三步串起来：语气词绝不入记忆', () => {
  assert.equal(cleanContent('嗯，我叫小明你可以叫我小明吧'), '我叫小明你可以叫我小明')
  assert.equal(cleanContent('我性格比较内向呢'), '我性格比较内向')
  assert.ok(!cleanContent('我喜欢咖啡吧').includes('吧'))
})

test('cleanContent 剥掉 XML 标签残留，不把标签当记忆', () => {
  // 曾经因为 pre-step 抓到的文本尾部带 </user_message>，把它当成了偏好记下来
  assert.equal(cleanContent('</user_message>'), '')
  assert.equal(cleanContent('我喜欢猫</user_message>'), '我喜欢猫')
  assert.equal(cleanContent('<system-reminder>我住在杭州</system-reminder>'), '我住在杭州')
})
