/**
 * 敏感信息判定：黑名单词 + 凭证形态正则。
 * 命中黑名单的记忆一律拒写（不是加密，是根本不落盘），对应需求 4.3。
 */
import type { MemoryType, Sensitivity } from './types.ts'

/** 凭证形态：身份证、银行卡、手机号、验证码、密钥。 */
const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: '身份证', pattern: /\b\d{17}[\dXx]\b/ },
  { name: '银行卡', pattern: /\b(?:\d[ -]?){15,19}\b/ },
  { name: '手机号', pattern: /\b1[3-9]\d{9}\b/ },
  { name: '验证码', pattern: /(?:验证码|校验码|动态码)\D{0,6}\d{4,8}/ },
  { name: '密钥', pattern: /\b(?:sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,})\b/ },
  { name: '邮箱口令', pattern: /[\w.+-]+@[\w-]+\.[\w.]+\s*[/／]\s*\S{4,}/ },
]

/** 健康类记忆默认视为敏感。 */
const SENSITIVE_TYPES = new Set<MemoryType>(['health'])

/** 返回命中的黑名单词（空数组表示干净）。 */
export function matchBlacklist(text: string, blacklist: string[]): string[] {
  const lowered = text.toLowerCase()
  return blacklist.filter((word) => word !== '' && lowered.includes(word.toLowerCase()))
}

/** 返回命中的凭证形态名称。 */
export function matchCredentials(text: string): string[] {
  return CREDENTIAL_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.name)
}

/** 内容里是否含不可写入的敏感信息。 */
export function isForbidden(text: string, blacklist: string[]): { forbidden: boolean; reasons: string[] } {
  const hits = [...matchBlacklist(text, blacklist), ...matchCredentials(text)]
  return { forbidden: hits.length > 0, reasons: [...new Set(hits)] }
}

/** 是否属于「sensitive」一类（健康类 / 含隐私信号的表述）。 */
export function classifySensitivity(type: MemoryType, text: string): Sensitivity {
  if (SENSITIVE_TYPES.has(type)) return 'sensitive'
  if (/(病情|病史|过敏|抑郁症|焦虑症|怀孕|手术|吃药|诊断|体检报告)/.test(text)) return 'sensitive'
  if (/(工资|年薪|存款|负债|贷款|房贷|信用卡账单|资产)/.test(text)) return 'sensitive'
  return 'normal'
}

/** 打码：把黑名单词与凭证形态替换成 ██，用于日志与工具输出。 */
export function maskSensitive(text: string, blacklist: string[]): string {
  let out = text
  for (const word of blacklist) {
    if (word === '') continue
    out = out.replace(new RegExp(escapeRegExp(word), 'gi'), '█'.repeat(Math.max(2, word.length)))
  }
  for (const item of CREDENTIAL_PATTERNS) out = out.replace(item.pattern, '█'.repeat(6))
  return out
}

/** 正则转义，避免用户把 `.` 之类写进黑名单时炸掉。 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
