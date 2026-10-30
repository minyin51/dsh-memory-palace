/** score = 相似度×w1 + 频次×w2 + 时间衰减×w3。 */
export interface ScoreWeights {
    similarity: number;
    frequency: number;
    recency: number;
}
/** 插件配置。 */
export interface MemoryConfig {
    /** 总开关；关掉后不注入、不提取、不注册工具。 */
    enabled: boolean;
    /** 每轮最多注入几条。 */
    top_k: number;
    /** 单次注入的 token 上限（硬上限 500）。 */
    inject_max_tokens: number;
    /** 同一内容命中多少次后不再重复加日志/提示（去重阈值）。 */
    dedup_hits: number;
    /** 普通记忆的时间衰减半衰期（天）。 */
    decay_days: number;
    /** decision 类记忆的衰减期（决定通常更耐用）。 */
    decision_decay_days: number;
    /** 三项权重。 */
    score_weights: ScoreWeights;
    /** 低于该分数的候选不注入。 */
    memory_min_score: number;
    /** 命中即拒写的敏感词（密码、证件号等）。 */
    sensitive_blacklist: string[];
    /** 健康类记忆默认不落盘，必须显式打开。 */
    health_memory_enabled: boolean;
    /** 敏感内容落盘方式：encrypt（默认）或 plain。 */
    sensitive_storage: 'encrypt' | 'plain';
    /** 提取用的模型通道（当前实现为规则提取，保留字段）。 */
    extractor_model?: string;
    /** 提取写入是否异步（turn/end 之后排队执行）。 */
    async_write: boolean;
    /** 记忆文件路径；缺省 ~/.dsh/user-memory/memory.json。 */
    storage_path?: string;
    /** 固定用户 id；缺省用匿名用户 id。 */
    user_id?: string;
    /** 单用户条目上限，超出按分数淘汰最旧的。 */
    max_entries_per_user: number;
    /** 是否输出运行日志。 */
    log: boolean;
}
/** 默认配置。 */
export declare const DEFAULT_CONFIG: MemoryConfig;
/** 把任意输入合并进默认配置：只接受类型正确的字段，数值做区间钳制。 */
export declare function resolveConfig(input?: unknown): MemoryConfig;
/** 记忆文件默认位置：~/.dsh/user-memory/memory.json（可用 DSH_USER_MEMORY_PATH 覆盖）。 */
export declare function defaultStoragePath(): string;
/** 真正使用的存储路径。 */
export declare function storagePathOf(config: MemoryConfig): string;
