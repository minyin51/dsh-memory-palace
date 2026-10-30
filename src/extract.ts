/**
 * 记忆提取：规则版（无模型依赖，确定性、可单测）。
 * 每个规则给出 type + 内容模板 + 重要性/稳定性；「值得记忆度 = 重要性 × 稳定性」低于阈值丢弃。
 */
import type { MemoryConfig } from './config.ts'
import { classifySensitivity, isForbidden } from './sensitive.ts'
import { cleanContent, keywordize } from './text.ts'
import type { MemoryCandidate, MemoryType } from './types.ts'

/** 单条规则：正则命中后按模板生成内容。 */
interface Rule {
  type: MemoryType
  pattern: RegExp
  template: (match: RegExpMatchArray) => string
  importance: number
  stability: number
  subject?: (match: RegExpMatchArray) => string
}

/** 规则表：顺序即优先级，同一句命中多条时按 content 去重后都保留。 */
const RULES: Rule[] = [
  // ── 身份 ──
  { type: 'identity', pattern: /我叫([\p{Script=Han}A-Za-z0-9_]{1,12}?)(?=可以|你|他|她|我们|[，。！？、,.!?\s]|$)/u, template: (m) => `名字是${m[1]}`, importance: 1, stability: 1, subject: () => 'name' },
  { type: 'identity', pattern: /叫我([\p{Script=Han}A-Za-z0-9]{1,10}?)(?=[，。！？、,.!?\s]|$)/u, template: (m) => `称呼${m[1].replace(/[吧呀啦啊哦呢]+$/u, '')}`, importance: 0.9, stability: 1, subject: () => 'nickname' },
  { type: 'identity', pattern: /我是(?:一名|一个)?([\p{Script=Han}A-Za-z0-9]{2,12})(?:学生|老师|工程师|程序员|医生|设计师|研究生|大[一二三四]学生)?/u, template: (m) => `身份是${m[1]}`, importance: 0.8, stability: 0.9, subject: () => 'role' },
  { type: 'identity', pattern: /我在([\p{Script=Han}]{2,10})(?:工作|上班|读书|上学)/u, template: (m) => `在${m[1]}工作/学习`, importance: 0.8, stability: 0.8, subject: () => 'place' },
  { type: 'identity', pattern: /我(?:住在|家在)([\p{Script=Han}]{2,12})/u, template: (m) => `住在${m[1]}`, importance: 0.8, stability: 0.7, subject: () => 'city' },
  { type: 'identity', pattern: /在([\p{Script=Han}A-Za-z]{2,10}?)(?:做|干)([\p{Script=Han}A-Za-z]{2,10})/u, template: (m) => `在${m[1]}做${m[2]}`, importance: 0.7, stability: 0.7, subject: () => 'work' },
  // ── 性格 ──
  { type: 'personality', pattern: /我(?:的)?(?:性格|脾气)(?:比较|有点|很|挺|特别|属于|是)?(内向|外向|慢热|社恐|社牛|乐观|悲观|拖延|完美主义|话少|话多|急躁|温和|敏感|理性|感性|记性差)/u, template: (m) => `性格${m[1]}`, importance: 0.7, stability: 0.9, subject: () => 'trait' },
  // ── 兴趣 ──
  { type: 'interest', pattern: /我(?:平时|最近|一直|很|特别|比较)?(?:喜欢|爱|沉迷于?|爱好是)([\p{Script=Han}A-Za-z0-9 ]{1,16})/u, template: (m) => `喜欢${m[1].trim()}`, importance: 0.6, stability: 0.7 },
  // ── 技能 ──
  { type: 'skill', pattern: /我(?:会|擅长|精通|熟练|正在学|在学)([\p{Script=Han}A-Za-z0-9+# ]{1,16})/u, template: (m) => `会${m[1].trim()}`, importance: 0.7, stability: 0.8 },
  // ── 目标 ──
  { type: 'goal', pattern: /我(?:想|打算|计划|准备|希望|目标是)([\p{Script=Han}A-Za-z0-9 ，,]{1,28})/u, template: (m) => `目标是${m[1].trim()}`, importance: 0.8, stability: 0.6 },
  // ── 生活事件 ──
  { type: 'life_event', pattern: /我(?:考上|录取了|被录取|搬到|搬去|毕业|入职|辞职|分手|结婚|养了|生了)([\p{Script=Han}A-Za-z0-9 ，,]{0,20})/u, template: (m) => `${m[0].trim()}`, importance: 0.7, stability: 0.5 },
  // ── 偏好（工具/方式类）──
  { type: 'preference', pattern: /我(?:习惯|偏好|喜欢)(?:用|把|让|叫)([\p{Script=Han}A-Za-z0-9 ，,]{1,24})/u, template: (m) => `习惯用${m[1].trim()}`, importance: 0.7, stability: 0.8, subject: () => 'tool' },
  { type: 'preference', pattern: /(?:现在|最近|已经)?(?:改用|改成|换成|换用)([\p{Script=Han}A-Za-z0-9 .]{1,24})/u, template: (m) => `改用${m[1].trim().replace(/[了的]+$/u, '')}`, importance: 0.6, stability: 0.6, subject: () => 'tool' },
  { type: 'preference', pattern: /请(?:你)?(?:以后)?(?:用|说|回答|写)([\p{Script=Han}A-Za-z0-9 ，,]{1,20})/u, template: (m) => `要求${m[1].trim()}`, importance: 0.7, stability: 0.8 },
  // ── 关系 ──
  { type: 'relationship', pattern: /我(?:的)?(妈妈|爸爸|妈|爸|女朋友|男朋友|老婆|老公|室友|同事|导师|姐姐|哥哥|弟弟|妹妹)(?:是|叫|在)([\p{Script=Han}A-Za-z0-9 ，,]{1,20})/u, template: (m) => `${m[1]}${m[2].trim()}`, importance: 0.7, stability: 0.7, subject: (m) => m[1] },
  // ── 边界 ──
  { type: 'boundary', pattern: /(?:别|不要|不用|讨厌|不喜欢|受不了)([\p{Script=Han}A-Za-z0-9 ，,]{1,20})/u, template: (m) => `不要${m[1].trim()}`, importance: 0.8, stability: 0.9 },
  // ── 决定 ──
  { type: 'decision', pattern: /我(?:已经)?(?:决定|定了|选择|就选)([\p{Script=Han}A-Za-z0-9 ，,]{1,28})/u, template: (m) => `决定${m[1].trim()}`, importance: 0.8, stability: 0.9 },
  // ── 健康 ──
  { type: 'health', pattern: /我对([\p{Script=Han}A-Za-z0-9 ]{1,12})过敏/u, template: (m) => `对${m[1].trim()}过敏`, importance: 0.9, stability: 0.9, subject: (m) => `allergy:${m[1].trim()}` },
  { type: 'health', pattern: /我(?:有|得了|查出)([\p{Script=Han}A-Za-z0-9 ]{1,12}(?:病|症|炎))/u, template: (m) => `有${m[1].trim()}`, importance: 0.9, stability: 0.8 },
  // ── 资源 ──
  { type: 'resource', pattern: /我(?:有|用|在用|买了个?)([\p{Script=Han}A-Za-z0-9 ]{1,16}(?:电脑|手机|显卡|服务器|相机|键盘|显示器|NAS))/u, template: (m) => `有${m[1].trim()}`, importance: 0.6, stability: 0.8 },
  // ── 里程碑 ──
  { type: 'milestone', pattern: /我(?:拿到|获得|通过|考过|拿了)([\p{Script=Han}A-Za-z0-9 ，,]{1,26})/u, template: (m) => `${m[0].trim()}`, importance: 0.8, stability: 0.8 },
]

/** 「记住/忘掉」自然语言指令。 */
export interface MemoryCommands {
  remember: string[]
  forget: string[]
}

/** 识别「记住这个」「忘掉刚才说的」这类显式指令。 */
export function extractCommands(text: string): MemoryCommands {
  const remember: string[] = []
  const forget: string[] = []
  for (const match of text.matchAll(/(?:记住|记一下|记下来|帮我记着)[：:，,]?\s*([^\n。！？!?]{1,80})/gu)) {
    if (match[1] !== undefined) remember.push(cleanContent(match[1]))
  }
  for (const match of text.matchAll(/(?:忘掉|忘记|删掉|别记)[：:，,]?\s*([^\n。！？!?]{1,80})/gu)) {
    if (match[1] !== undefined) forget.push(cleanContent(match[1]))
  }
  return { remember: remember.filter((item) => item !== ''), forget: forget.filter((item) => item !== '') }
}

/**
 * 宠物：一句里可能同时说数量和多个名字（「养了两只猫，一只叫开心一只叫妙妙」），
 * 规则表的正则会吞掉整段，所以单独扫一遍。
 */
function petCandidates(sentence: string, sourceSession?: string): MemoryCandidate[] {
  const found: MemoryCandidate[] = []
  const count = sentence.match(/我(?:家)?(?:里)?(?:养了|养着)([一二两三四五六七八九十\d]+)只([\p{Script=Han}]{1,3})/u)
  if (count !== null) {
    const text = `养了${count[1]}只${count[2]}`
    found.push({
      type: 'life_event',
      content: cleanContent(text),
      keywords: keywordize(`${text} 宠物 ${count[2]}`),
      subject: 'pets',
      importance: 0.7,
      stability: 0.9,
      sensitivity: 'normal',
      source_session: sourceSession,
    })
  }
  for (const match of sentence.matchAll(/(?:一只|另一只|还有一只|其中一只)(?:叫|名叫)([\p{Script=Han}]{1,4}?)(?=一只|另一只|还有一只|其中一只|[，。！？、,.!?\s]|$)/gu)) {
    const name = match[1]
    if (name === undefined) continue
    const text = `宠物叫${name}`
    found.push({
      type: 'relationship',
      content: cleanContent(text),
      keywords: keywordize(`${text} 宠物 名字 ${name}`),
      subject: `pet:${name}`,
      importance: 0.7,
      stability: 0.9,
      sensitivity: 'normal',
      source_session: sourceSession,
    })
  }
  return found
}

/** 按句切分：规则只看句子，避免把上一句的主语拼到下一句里。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n；;]+/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * 从一段文本里提取候选记忆。
 * @param text 待提取文本（通常是一轮里用户说的话）
 * @param config 配置（读 sensitive_blacklist / memory_min_score）
 * @param sourceSession 来源会话 id
 */
export function extractMemories(text: string, config: MemoryConfig, sourceSession?: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = []
  const seen = new Set<string>()

  for (const sentence of splitSentences(text)) {
    for (const rule of RULES) {
      const match = sentence.match(rule.pattern)
      if (match === null) continue
      const content = cleanContent(rule.template(match))
      if (content === '' || seen.has(content)) continue
      const forbidden = isForbidden(content, config.sensitive_blacklist)
      if (forbidden.forbidden) continue
      const score = rule.importance * rule.stability
      if (score < config.memory_min_score) continue
      seen.add(content)
      candidates.push({
        type: rule.type,
        content,
        keywords: keywordize(`${content} ${rule.subject?.(match) ?? ''}`),
        subject: rule.subject?.(match),
        importance: rule.importance,
        stability: rule.stability,
        sensitivity: classifySensitivity(rule.type, content),
        source_session: sourceSession,
      })
    }

    // 宠物这类「一句多值」的内容，规则表覆盖不全，单独补一轮。
    for (const candidate of petCandidates(sentence, sourceSession)) {
      if (candidate.content === '' || seen.has(candidate.content)) continue
      if (isForbidden(candidate.content, config.sensitive_blacklist).forbidden) continue
      if (candidate.importance * candidate.stability < config.memory_min_score) continue
      seen.add(candidate.content)
      candidates.push({ ...candidate, sensitivity: classifySensitivity(candidate.type, candidate.content) })
    }
  }
  return candidates
}

/** 显式「记住」的内容转成候选：类型未知时归到 preference，重要性拉满。 */
export function candidatesFromCommands(commands: MemoryCommands, config: MemoryConfig, sourceSession?: string): MemoryCandidate[] {
  return commands.remember
    .map((item) => cleanContent(item))
    .filter((item) => item !== '' && !isForbidden(item, config.sensitive_blacklist).forbidden)
    .map((content) => ({
      type: 'preference' as MemoryType,
      content,
      keywords: keywordize(content),
      importance: 1,
      stability: 1,
      sensitivity: 'normal' as const,
      source_session: sourceSession,
    }))
}
