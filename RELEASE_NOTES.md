# DSH-Paper-DeepRead 1.1.3

Release date: 2026-10-30

**English** | [中文](#中文)

## Fix

Model-tool outputs are now **lossless JSON**.

v1.1.2's `paper_deepread` tool could fail in the live web profile with:

```text
tool "paper_deepread" returned invalid output: value is not lossless JSON
```

Cause: absent optional fields were returned as `undefined` object properties
(`publicPaper` did `doi: paper.doi || undefined`, `publicLibrary` did
`version/buildDate || undefined`; the uploads tool did `path/hint: ... ?? undefined`
and the reports tool did `rebuild: ... : undefined`). DSH's tool-output validator
rejects values whose JSON round-trip loses keys, so papers without a DOI (and other
sparse records) broke the call.

v1.1.3 passes every tool `execute` result through one recursive sanitizer
(`src/lossless.js`): `undefined`/function/symbol/BigInt object properties are omitted,
array holes become `null`, `NaN`/`Infinity` become `null`, cycles become `null`. The
three tools keep identical names, descriptions, parameters and payload shapes — only
non-JSON properties disappear.

## Regression test

`tests/lossless.test.js` recursively rejects undefined/NaN/Infinity, then asserts
`JSON.parse(JSON.stringify(value))` deep-equals the payload for:

- `paper_deepread`: bundled library list / substring query / id lookup / missing id
- `paper_deepread_uploads`: list with a synthetic failed upload record + delete error
- `paper_deepread_reports`: list on the real bundled library + invalid dir/build errors

It fails on v1.1.2 with `paper_deepread list.papers[1].doi: undefined` and
`paper_deepread_uploads list.python.hint: undefined`, and passes on v1.1.3
(`npm test`: 25/25).

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.3.tgz
```

Then restart `dsh web`. Upgrading from 1.1.2 is in place: managed data
(`$DSH_HOME/paper-deepread`) and any `libraryDir` configuration are untouched. This is a
content-only patch — the bundled library, skill, HTTP API and tool parameters are
unchanged from v1.1.2.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (verified against `0.2.1-rc.3`)
- Node.js `>= 24`

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.3

发布日期：2026-10-30

## 修复

模型工具输出现在是**无损 JSON**。

v1.1.2 的 `paper_deepread` 工具在线上 web profile 会失败：

```text
tool "paper_deepread" returned invalid output: value is not lossless JSON
```

原因：缺省可选字段以 `undefined` 属性返回（`publicPaper` 的
`doi: paper.doi || undefined`、`publicLibrary` 的 `version/buildDate || undefined`；
uploads 工具的 `path/hint: ... ?? undefined`、reports 工具的 `rebuild: ... : undefined`）。
DSH 的工具输出校验器会拒绝 JSON 往返后丢键的值，因此没有 DOI 的论文（以及其他稀疏记录）
会触发错误。

v1.1.3 让每个工具的 `execute` 返回值统一经过递归清洗器（`src/lossless.js`）：
`undefined`/函数/symbol/BigInt 对象属性被省略，数组空位变 `null`，`NaN`/`Infinity` 变
`null`，循环引用变 `null`。三个工具的名称、描述、参数与返回结构不变，只是移除了非 JSON 属性。

## 回归测试

`tests/lossless.test.js` 递归拒绝 undefined/NaN/Infinity，并断言
`JSON.parse(JSON.stringify(value))` 与载荷深度相等，覆盖：

- `paper_deepread`：内置书库列表 / 子串查询 / id 查询 / 不存在的 id
- `paper_deepread_uploads`：含合成失败上传记录的列表 + 删除错误
- `paper_deepread_reports`：真实内置书库的列表 + 非法目录/构建错误

该测试在 v1.1.2 失败（`paper_deepread list.papers[1].doi: undefined`、
`paper_deepread_uploads list.python.hint: undefined`），在 v1.1.3 通过
（`npm test`：25/25）。

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.3.tgz
```

然后重启 `dsh web`。从 1.1.2 原地升级：受管数据（`$DSH_HOME/paper-deepread`）与
`libraryDir` 配置不受影响。这是纯内容补丁——内置书库、技能、HTTP API 与工具参数均与
v1.1.2 相同。

## 环境要求

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 验证）
- Node.js `>= 24`

## 许可证

MIT © 2026 HaoKuo

</details>
