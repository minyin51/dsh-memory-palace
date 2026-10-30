/**
 * 文本工具：归一化、分词、相似度、token 估算、注入内容清洗。
 * 不引第三方分词库（依赖最少化）：中文按二元组切，英文按单词切。
 */
/** 中文停用词：不参与关键词与相似度，否则「我/的/了」会让所有记忆互相相似。 */
const STOPWORDS = new Set([
    '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是', '在', '有', '和', '就', '都', '也',
    '很', '吗', '呢', '吧', '啊', '这', '那', '这个', '那个', '一个', '不是', '没有', '什么', '怎么', '可以',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'it', 'i', 'you',
    'my', 'me', 'we', 'they', 'he', 'she', 'that', 'this', 'for', 'with', 'as', 'be', 'do', 'have',
]);
/** 归一化：全半角折叠、小写、标点转空格。 */
export function normalize(text) {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** 分词：英文单词 + 中文二元组 + 单个中文字符（短句兜底）。 */
export function tokenize(text) {
    const normalized = normalize(text);
    const tokens = [];
    const words = normalized.match(/[a-z0-9_]+/g) ?? [];
    for (const word of words) {
        if (word.length >= 2 && !STOPWORDS.has(word))
            tokens.push(word);
    }
    const han = normalized.replace(/[^\p{Script=Han}]/gu, '');
    for (let i = 0; i < han.length - 1; i += 1) {
        const bigram = han.slice(i, i + 2);
        if (!STOPWORDS.has(bigram))
            tokens.push(bigram);
    }
    return tokens;
}
/** 取关键词：按词频排序，去重，最多 limit 个。 */
export function keywordize(text, limit = 6) {
    const counts = new Map();
    for (const token of tokenize(text))
        counts.set(token, (counts.get(token) ?? 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, limit)
        .map(([token]) => token);
}
/** 两段文本的 Jaccard 相似度（基于 token 集合）。 */
export function jaccard(a, b) {
    const left = new Set(tokenize(a));
    const right = new Set(tokenize(b));
    if (left.size === 0 || right.size === 0)
        return 0;
    let shared = 0;
    for (const token of left)
        if (right.has(token))
            shared += 1;
    return shared / (left.size + right.size - shared);
}
/**
 * token 估算：中文 1 字≈1 token，ASCII 4 字符≈1 token，空格/标点按 0.5 计。
 * 故意偏保守（宁多算不少算），保证注入不超预算。
 */
export function estimateTokens(text) {
    if (text === '')
        return 0;
    let cjk = 0;
    let ascii = 0;
    let other = 0;
    for (const char of text) {
        if (/\p{Script=Han}/u.test(char))
            cjk += 1;
        else if (/[\x20-\x7e]/.test(char))
            ascii += 1;
        else
            other += 1;
    }
    return Math.ceil(cjk + ascii / 4 + other / 2);
}
/** 按 token 预算截断文本，超出时补省略号。 */
export function truncateToTokens(text, budget) {
    if (estimateTokens(text) <= budget)
        return text;
    let out = '';
    let used = 0;
    for (const char of text) {
        const cost = /\p{Script=Han}/u.test(char) ? 1 : /[\x20-\x7e]/.test(char) ? 0.25 : 0.5;
        if (used + cost > budget)
            break;
        out += char;
        used += cost;
    }
    return `${out.trimEnd()}…`;
}
/** 是否含「改口」标记：这类记忆应覆盖旧版本而不是并排存在。 */
export function hasReplacementMarker(text) {
    return /(现在|目前|改成|改为|改用|换成|换用|换了|搬去|搬到|不再|已经|以后|后来|之前是|现在是|instead|now i|no longer|moved to)/i.test(text);
}
/** 是否像提示词注入（用于注入隔离：命中即降级为「引用原文」）。 */
export function looksInstructive(text) {
    return /(忽略|无视|忽视|覆盖|绕过).{0,10}(规则|指令|设定|限制|要求)|(ignore|disregard|forget).{0,20}(instruction|rule|prompt|previous)|(system\s*prompt|系统提示|开发者指令|jailbreak|越狱)/i.test(text);
}
/** 清洗提取出的内容：去控制字符、合并空白、去掉首尾标点、限长。 */
/** 语气词：只表达态度、不携带信息，记忆前一律剔除。 */
const PARTICLES = '吧呀啦啊哦呢嘛呗哈咯喽嘿唉嗯呃噢喔哟呐嘞哇咯';
/** 含「的/是」但拆开就变意思的词，先占位保护再还原。 */
const KEEP_SHIDE_WORDS = [
    '但是', '可是', '还是', '只是', '总是', '就是', '要是', '于是', '而是', '凡是',
    '算是', '或是', '以及', '目的', '似的', '是的', '的确', '的话', '别的', '有的', '真的', '倒是',
];
/**
 * 去掉语气词与口语停顿。
 * 「嗯，我其实喜欢咖啡吧」→「我其实喜欢咖啡」
 */
export function stripParticles(text) {
    const withoutLead = (() => {
        let rest = text;
        // 句首可能叠着好几层停顿词：「嗯，那个其实……」
        for (;;) {
            const next = rest.replace(/^(?:嗯+|呃+|额+|啊+|哦+|唉+|那个|这个|就是|其实|然后|所以|反正|怎么说呢)[，,。！？!?\s]*/u, '');
            if (next === rest)
                return rest;
            rest = next;
        }
    })();
    return withoutLead
        // 句末连串语气词（吧啦、呀～ 这类叠加）
        .replace(/[吧呀啦啊哦呢嘛呗哈咯喽嘿唉嗯呃噢喔哟呐嘞哇～~]+$/u, '')
        // 分句结尾的语气词（后面紧跟标点）
        .replace(/[吧呀啦啊哦呢嘛呗咯喽哇]+(?=[，,。！？!?；;])/gu, '')
        // 单独成段的感叹词
        .replace(/(?<=[，,。！？!?；;\s])[嗯呃唉哦啊噢喔哟]+(?=[，,。！？!?；;\s])/gu, '')
        .trim();
}
/**
 * 去掉「的 / 是 / 地 / 得」这类只起连接作用、不携带信息的虚词。
 * 「名字是小明」→「名字小明」；「但是」这类词原样保留。
 */
export function stripConnectives(text) {
    let out = text;
    for (const word of KEEP_SHIDE_WORDS)
        out = out.split(word).join(`\u0000${word}\u0000`);
    out = out
        .replace(/([\u4e00-\u9fff])[的是地得](?=[\u4e00-\u9fff])/gu, '$1')
        .replace(/的+$/u, '');
    return out.split('\u0000').join('');
}
/**
 * 按标点/语气词切分句，挑信息量最大的那一句当重点。
 * 「我喜欢咖啡，不过其实更喜欢茶吧」→「不过其实更喜欢茶」
 * 分句太短（< 4 个实词）时退回整句，避免把信息切丢。
 */
export function keyPhrase(text) {
    const clauses = text
        .split(/[，,。！？!?；;：:、\n]+/u)
        .map((part) => part.trim())
        .filter((part) => part !== '');
    if (clauses.length <= 1)
        return text;
    const infoOf = (clause) => {
        let count = 0;
        for (const ch of clause.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')) {
            if (!STOPWORDS.has(ch) && !PARTICLES.includes(ch))
                count += 1;
        }
        return count;
    };
    let best = clauses[0];
    let bestScore = infoOf(best);
    for (const clause of clauses.slice(1)) {
        const score = infoOf(clause);
        if (score > bestScore) {
            best = clause;
            bestScore = score;
        }
    }
    return bestScore >= 4 ? best : text;
}
/**
 * 记忆文本蒸馏：去语气词 → 取重点分句 → 去连接虚词。
 * 语气词永远不会被写进记忆，因为它不携带可回忆的信息。
 */
export function distill(text) {
    const withoutParticles = stripParticles(text);
    const focused = keyPhrase(withoutParticles);
    return stripConnectives(focused).replace(/\s+/g, ' ').trim();
}
export function cleanContent(text, maxLength = 160) {
    const cleaned = distill(text)
        // 先剥掉 XML/HTML 样式标签（如 </user_message>、<system-reminder> 残片），避免把标签本身当记忆
        .replace(/<\/?[a-zA-Z][^<>]{0,60}>/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[，,。.、；;：:！!？?\s]+/, '')
        .replace(/[，,、；;：:\s]+$/, '');
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}
/** HTML/标签转义：记忆内容里出现 `<memory>` 之类不能破坏注入结构。 */
export function escapeTags(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
