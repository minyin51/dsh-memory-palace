/**
 * 记忆提取：规则版（无模型依赖，确定性、可单测）。
 * 每个规则给出 type + 内容模板 + 重要性/稳定性；「值得记忆度 = 重要性 × 稳定性」低于阈值丢弃。
 */
import type { MemoryConfig } from './config.ts';
import type { MemoryCandidate } from './types.ts';
/** 「记住/忘掉」自然语言指令。 */
export interface MemoryCommands {
    remember: string[];
    forget: string[];
}
/** 识别「记住这个」「忘掉刚才说的」这类显式指令。 */
export declare function extractCommands(text: string): MemoryCommands;
/**
 * 从一段文本里提取候选记忆。
 * @param text 待提取文本（通常是一轮里用户说的话）
 * @param config 配置（读 sensitive_blacklist / memory_min_score）
 * @param sourceSession 来源会话 id
 */
export declare function extractMemories(text: string, config: MemoryConfig, sourceSession?: string): MemoryCandidate[];
/** 显式「记住」的内容转成候选：类型未知时归到 preference，重要性拉满。 */
export declare function candidatesFromCommands(commands: MemoryCommands, config: MemoryConfig, sourceSession?: string): MemoryCandidate[];
