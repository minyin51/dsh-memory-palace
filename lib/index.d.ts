/** 插件名，与 package.json / cordis.patch.yml 保持一致。 */
export declare const name = "dsh-memory-palace";
/** 依赖的宿主服务。 */
export declare const inject: string[];
/** 宿主 ctx 的最小形状（只写用得到的部分，避免依赖 cordis 类型包）。 */
interface PluginContext {
    logger?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
    };
    systemPrompt?: {
        section(definition: {
            name: string;
            order?: number;
            text: string | (() => string);
            interpolate?: boolean;
        }): unknown;
    };
    tools?: {
        register(definition: unknown): unknown;
    };
    inject?(services: string[], callback: (ctx: PluginContext) => void): () => void;
    on?(event: string, listener: (...args: any[]) => unknown, options?: {
        prepend?: boolean;
    }): () => void;
}
/** 插件入口。 */
export declare function apply(ctx: PluginContext, rawConfig: unknown): Promise<void>;
export {};
