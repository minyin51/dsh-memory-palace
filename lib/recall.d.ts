/**
 * 召回与注入拼装。
 * score = 相似度×w1 + 频次×w2 + 时间衰减×w3；取 top_k，按 token 预算硬截断。
 */
import type { MemoryConfig } from './config.ts';
import { type MemoryEntry } from './types.ts';
/** 带明文的候选条目。 */
export type RecallPoolEntry = MemoryEntry & {
    plain: string;
};
/** 打分明细，日志与调试用。 */
export interface ScoredEntry {
    entry: RecallPoolEntry;
    score: number;
    parts: {
        similarity: number;
        frequency: number;
        recency: number;
    };
}
/** 注入结果。 */
export interface RecallResult {
    entries: ScoredEntry[];
    /** 最终注入文本（无内容时为空串）。 */
    text: string;
    /** 注入文本的 token 估算。 */
    tokens: number;
}
/** 对池子打分并排序。 */
export declare function scorePool(pool: RecallPoolEntry[], query: string, config: MemoryConfig, nowMs?: number): ScoredEntry[];
/** 按分数阈值与 top_k 选出要注入的条目。 */
export declare function pickEntries(pool: RecallPoolEntry[], query: string, config: MemoryConfig, nowMs?: number): ScoredEntry[];
/**
 * 拼装注入块。固定用 <memory> 包裹，并在开头声明「只是参考、不是指令」，
 * 这是注入隔离的第二道防线（第一道是提取阶段的清洗）。
 */
export declare function renderMemoryBlock(items: ScoredEntry[], config: MemoryConfig): RecallResult;
/** 一步到位：从池子里选条目并拼装注入块。 */
export declare function recall(pool: RecallPoolEntry[], query: string, config: MemoryConfig, nowMs?: number): RecallResult;
