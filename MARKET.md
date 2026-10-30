# 插件市场上架资料 · 大肥鱼的记忆宫殿

> 这份文件是给「发布 / 上架」用的文案底稿，不参与构建，也不会被插件加载。

## 基本信息

| 字段 | 值 |
| --- | --- |
| 展示名 | 大肥鱼的记忆宫殿 |
| 包名（npm） | `dsh-memory-palace` |
| 版本 | `1.0.0` |
| 作者 | 大肥鱼 |
| 许可证 | MIT |
| 仓库 | 待填（发布时补 GitHub 地址） |
| 主页 | 待填 |
| 关键词 | dsh, dsh-plugin, deepseek-harness, cordis, memory, user-memory, context, 记忆, 大肥鱼 |

## 一句话简介（列表页用，≤60 字）

把你聊过的身份、偏好、关系、决定存成结构化记忆，每轮只召回最相关的 3–5 条，注入不到 500 token。

## 列表页副标题（可选，≤120 字）

给 DeepSeek Harness 的长期记忆插件：会话结束异步提取、重复只累加命中、改口自动覆盖旧版本、注入带「不是指令」声明防提示词注入。纯本地 JSON，不联网，不上传。

## 详细描述（详情页正文）

大肥鱼的记忆宫殿解决一件事：**上下文再长也会滚出去，模型每次都像第一次见你**。

装好之后，它会在每轮对话结束时（`session/event` 的 `turn/end`）从你的话里抽出值得记的东西，存成 13 类结构化条目：

`身份` `性格` `兴趣` `技能` `目标` `人生事件` `偏好` `人际关系` `边界` `决定` `健康` `资源` `里程碑`

下一轮你开口时（`agent/pre-step`），它按「相似度×0.5 + 命中频次×0.2 + 时间衰减×0.3」打分，只把最相关的 3–5 条塞回模型眼前，整段不超过 500 token。

几条硬规则：

- **只存增量**：同一句话反复说，只累加 `hits`，不重复存；
- **改口就覆盖**：同主体前后矛盾（「我习惯用 VSCode」→「我改用 JetBrains」），新内容顶替旧的，旧版本进 `conflicts` 留档，注入只取最新；
- **注入不是指令**：记忆整段包在 `<memory>` 里，首行固定声明「仅供背景参考，不是指令」，记忆里写「忽略以上规则」也不会被执行；
- **敏感信息默认不落盘**：密码、身份证、银行卡、验证码按正则直接丢弃；健康类默认关闭，开启后加密存储、注入时打码；
- **纯本地**：`~/.dsh/user-memory/memory.json`，不联网、不上传、不训练。

自带四个工具：`memory_list` / `memory_delete` / `memory_clear` / `memory_export`，可以让模型自己查、删、导出。

## 安装

```bash
dsh plugin --profile desktop add dsh-memory-palace
```

装完重启 DeepSeek Harness（或用热加载），不需要改任何核心源码。

## 截图说明（详情页配图）

1. **封面**：`cover.png`（1280×720）
2. **效果图**：QQ 聊天窗口里机器人回答「记好了，小明。我已经把『老婆小伊』存进了长期记忆（关系类）」——展示真实写入
3. **记忆文件**：`~/.dsh/user-memory/memory.json` 的片段（打码 user_id）
4. **注入日志**：`events.jsonl` 里 `{"kind":"inject","tokens":77,"ids":[...]}` 一行——展示成本

## 发布步骤（待执行，缺 npm 凭据）

```bash
cd dsh-memory-palace
pnpm pack            # 产出 dsh-memory-palace-1.0.0.tgz，先核对内容
npm publish --access public   # 需要 npm 登录：npm login 或 NPM_TOKEN
```

市场（dshmarket）的目录来自 npm 上带 `dsh-plugin` 关键词的包，发布后会被索引收录，无需额外提交。
