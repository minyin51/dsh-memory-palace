import type { MemoryConfig } from './config.ts';
import type { MemoryStore } from './store.ts';
/** 注册工具所需的最小 ctx 形状（避免依赖 cordis 类型包）。 */
export interface ToolsHost {
    tools: {
        register(definition: unknown): unknown;
    };
}
/** 工具依赖。 */
export interface ToolsDeps {
    store: MemoryStore;
    config: MemoryConfig;
    userId: () => string;
}
/** 注册四个工具。 */
export declare function registerMemoryTools(host: ToolsHost, deps: ToolsDeps): void;
