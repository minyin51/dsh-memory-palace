import type { MemoryCandidate, MemoryEntry, MemoryFile, MemoryType, Sensitivity, UpsertResult } from './types.ts';
/** 敏感内容的落盘策略。 */
export type SensitiveMode = 'drop' | 'encrypt' | 'plain';
/** 存储选项。 */
export interface StoreOptions {
    /** 单用户条目上限，超出后淘汰最久未更新的。 */
    maxEntriesPerUser: number;
    /** 敏感内容策略。 */
    sensitiveMode: SensitiveMode;
}
/** 内存里解出来的条目（加密条目在内存中是明文，落盘时再加密）。 */
interface StoredEntry extends MemoryEntry {
    /** 明文缓存：加密条目读出后放这里，save 时再写回 content。 */
    plain?: string;
}
/** 记忆库。 */
export declare class MemoryStore {
    private data;
    private key;
    private readonly file;
    private readonly options;
    constructor(file: string, options: StoreOptions);
    /** 构造时读盘失败的原因；显式 load() 会把它抛出来。 */
    private loadFailure;
    /** 从磁盘读取；文件不存在时视为空库（并在首次写入时创建）。 */
    load(): void;
    /** 原子写盘（先写 .tmp 再 rename），避免半截文件；`plain` 是内存缓存，绝不落盘。 */
    save(): void;
    /** 某用户的全部条目（按更新时间倒序）。 */
    entries(userId: string): StoredEntry[];
    /** 查询。 */
    list(userId: string, filter?: {
        type?: MemoryType;
        keyword?: string;
        limit?: number;
    }): MemoryEntry[];
    /** 按 id 取一条。 */
    get(userId: string, id: string): MemoryEntry | undefined;
    /**
     * 写入一条候选记忆。
     * 规则：重复内容 → 只加 hits；同主体矛盾 → 覆盖并把旧内容压进 conflicts；其余新增。
     */
    upsert(userId: string, candidate: MemoryCandidate): UpsertResult;
    /** 删除一条，返回是否删到。 */
    remove(userId: string, id: string): boolean;
    /** 清空某用户（或全部用户）。 */
    clear(userId?: string): number;
    /** 导出（默认导出当前用户；不传 user_id 时导出全库）。 */
    export(userId?: string): MemoryFile;
    /** 供召回使用的明文副本（不暴露加密态）。 */
    recallPool(userId: string): Array<MemoryEntry & {
        plain: string;
    }>;
    /** 超出上限时按最后更新时间淘汰。 */
    private enforceLimit;
    /** 对外形态：加密条目只给打码内容。 */
    private toPublic;
    /** 加密密钥：与记忆文件同目录的 memory.key（不存在则生成 0600 权限）。 */
    private encryptionKey;
    /** 敏感条目：落盘前加密。 */
    private encryptAll;
    /** 敏感条目：读出后解密到内存。 */
    private decryptAll;
    /** AES-256-GCM：iv(12) + tag(16) + 密文，base64 编码。 */
    private encrypt;
    /** 解密。 */
    private decrypt;
}
/** 判断敏感度是否需要特殊处理。 */
export declare function isSensitive(sensitivity: Sensitivity): boolean;
export {};
