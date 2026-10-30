/**
 * 文本工具：归一化、分词、相似度、token 估算、注入内容清洗。
 * 不引第三方分词库（依赖最少化）：中文按二元组切，英文按单词切。
 */
/** 归一化：全半角折叠、小写、标点转空格。 */
export declare function normalize(text: string): string;
/** 分词：英文单词 + 中文二元组 + 单个中文字符（短句兜底）。 */
export declare function tokenize(text: string): string[];
/** 取关键词：按词频排序，去重，最多 limit 个。 */
export declare function keywordize(text: string, limit?: number): string[];
/** 两段文本的 Jaccard 相似度（基于 token 集合）。 */
export declare function jaccard(a: string, b: string): number;
/**
 * token 估算：中文 1 字≈1 token，ASCII 4 字符≈1 token，空格/标点按 0.5 计。
 * 故意偏保守（宁多算不少算），保证注入不超预算。
 */
export declare function estimateTokens(text: string): number;
/** 按 token 预算截断文本，超出时补省略号。 */
export declare function truncateToTokens(text: string, budget: number): string;
/** 是否含「改口」标记：这类记忆应覆盖旧版本而不是并排存在。 */
export declare function hasReplacementMarker(text: string): boolean;
/** 是否像提示词注入（用于注入隔离：命中即降级为「引用原文」）。 */
export declare function looksInstructive(text: string): boolean;
/**
 * 去掉语气词与口语停顿。
 * 「嗯，我其实喜欢咖啡吧」→「我其实喜欢咖啡」
 */
export declare function stripParticles(text: string): string;
/**
 * 去掉「的 / 是 / 地 / 得」这类只起连接作用、不携带信息的虚词。
 * 「名字是小明」→「名字小明」；「但是」这类词原样保留。
 */
export declare function stripConnectives(text: string): string;
/**
 * 按标点/语气词切分句，挑信息量最大的那一句当重点。
 * 「我喜欢咖啡，不过其实更喜欢茶吧」→「不过其实更喜欢茶」
 * 分句太短（< 4 个实词）时退回整句，避免把信息切丢。
 */
export declare function keyPhrase(text: string): string;
/**
 * 记忆文本蒸馏：去语气词 → 取重点分句 → 去连接虚词。
 * 语气词永远不会被写进记忆，因为它不携带可回忆的信息。
 */
export declare function distill(text: string): string;
export declare function cleanContent(text: string, maxLength?: number): string;
/** HTML/标签转义：记忆内容里出现 `<memory>` 之类不能破坏注入结构。 */
export declare function escapeTags(text: string): string;
