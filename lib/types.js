/**
 * 记忆条目的类型枚举。
 * 与需求文档 4.1 的 13 类一一对应；新增类型时同步更新 MEMORY_TYPE_LABELS，
 * 否则召回/工具展示会退化成裸 type 名。
 */
export const MEMORY_TYPES = [
    'identity',
    'personality',
    'interest',
    'skill',
    'goal',
    'life_event',
    'preference',
    'relationship',
    'boundary',
    'decision',
    'health',
    'resource',
    'milestone',
];
/** 类型的中文标签，注入与工具输出时用。 */
export const MEMORY_TYPE_LABELS = {
    identity: '身份',
    personality: '性格',
    interest: '兴趣',
    skill: '技能',
    goal: '目标',
    life_event: '生活事件',
    preference: '偏好',
    relationship: '关系',
    boundary: '边界',
    decision: '决定',
    health: '健康',
    resource: '资源',
    milestone: '里程碑',
};
/** 是否为合法的 13 类之一。 */
export function isMemoryType(value) {
    return typeof value === 'string' && MEMORY_TYPES.includes(value);
}
