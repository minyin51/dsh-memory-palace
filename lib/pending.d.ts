/** 从磁盘读回上次没来得及写入的文本；读坏了就当成空。 */
export declare function loadPending(file: string): Map<string, string[]>;
/** 把当前待写入状态写回磁盘（内容很小，直接同步写）。 */
export declare function savePending(file: string, map: Map<string, string[]>): void;
