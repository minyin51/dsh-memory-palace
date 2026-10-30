/**
 * 敏感信息判定：黑名单词 + 凭证形态正则。
 * 命中黑名单的记忆一律拒写（不是加密，是根本不落盘），对应需求 4.3。
 */
import type { MemoryType, Sensitivity } from './types.ts';
/** 返回命中的黑名单词（空数组表示干净）。 */
export declare function matchBlacklist(text: string, blacklist: string[]): string[];
/** 返回命中的凭证形态名称。 */
export declare function matchCredentials(text: string): string[];
/** 内容里是否含不可写入的敏感信息。 */
export declare function isForbidden(text: string, blacklist: string[]): {
    forbidden: boolean;
    reasons: string[];
};
/** 是否属于「sensitive」一类（健康类 / 含隐私信号的表述）。 */
export declare function classifySensitivity(type: MemoryType, text: string): Sensitivity;
/** 打码：把黑名单词与凭证形态替换成 ██，用于日志与工具输出。 */
export declare function maskSensitive(text: string, blacklist: string[]): string;
/** 正则转义，避免用户把 `.` 之类写进黑名单时炸掉。 */
export declare function escapeRegExp(text: string): string;
