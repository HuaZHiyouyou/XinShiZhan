# 心事站 · 开源纯净版

这个目录是心事站的**纯净实例**：一份只有超级管理员、**不含任何其他数据**的空白站点。
拿它可以直接开始一个全新的部署，不会带上前一个实例的用户、心事、留言、弹幕、音乐或任何留痕。

---

## 一、超级管理员账号

| 项目 | 值 |
| --- | --- |
| 登录账号 | **`huazhiyou`** |
| 默认密码 | **`huazhiyouyou`** |
| 角色 | `superadmin`（超级管理员，站点所有者） |
| 用户编号 | `100001` |

登录入口：启动服务后打开 `http://localhost:8787` → 右上角「登录」。

> ## ⚠️ 首次登录后请立刻修改密码
>
> 默认口令是公开写在文档里的，**任何知道这份文档的人都能登录你的站点**。
>
> 修改路径：登录后 → 左侧「个人信息」→ 页面下方「**账号与安全**」区块
> → 填入「原密码」（`huazhiyouyou`）→ 设置新密码（至少 6 位）
> → 点击「保存账号设置」。
>
> 修改成功后，该账号此前在其他设备上的登录状态会**立即全部失效**。
>
> 如果你打算把这个站点放到公网，请务必在**第一次启动后、对外开放之前**完成这一步。

---

## 二、目录内容

```
opensource/
├─ README.md          本文件：账号信息与使用说明
├─ init-fresh.mjs     生成/重置纯净实例的脚本
├─ .gitignore         默认忽略 data/（含主密钥），说明见第四节
└─ data/              纯净实例的数据目录
   ├─ xinshizhan.db   完整表结构 + 仅一条超级管理员记录
   └─ master.key      本实例的主密钥
```

`data/` 里**刻意只有这两个文件**，没有任何说明文件或业务数据。

---

## 三、怎么用

### 方式 A：直接作为站点数据启动（推荐）

把 `opensource/data` 拷到 `server/data`，然后正常启动：

```bash
# 备份现有数据（如果 server/data 已存在）
move server\data server\data.backup        # Windows
# mv server/data server/data.backup        # macOS / Linux

xcopy opensource\data server\data /E /I   # Windows
# cp -r opensource/data server/data       # macOS / Linux

npm start
```

浏览器打开 <http://localhost:8787>，用上面的账号登录。

### 方式 B：不移动文件，直接指定数据目录

服务端支持 `XSZ_DATA_DIR` 环境变量，可以把数据放到任意位置：

```bash
set XSZ_DATA_DIR=%cd%\opensource\data && npm start      # Windows
# XSZ_DATA_DIR=$PWD/opensource/data npm start           # macOS / Linux
```

### 方式 C：重新生成一份

```bash
npm run fresh                                # 重新生成 opensource/data
npm run fresh -- D:\mysite-data              # 生成到指定目录
set XSZ_ADMIN_PASS=你的新口令 && npm run fresh   # 换一个初始口令
```

脚本会先清空目标目录，再建好全部空表、生成新的主密钥，并只创建超级管理员一个账号。
出于安全考虑，**它拒绝把 `server/data` 作为目标**，避免误删正在使用的数据。

---

## 四、关于 `data/` 与 `.gitignore`

`data/` 里的两样东西都不该进版本库：

- `xinshizhan.db`：虽然当前只有一条管理员记录，但一旦你的站点跑起来，它会不断写入真实用户数据；
- `master.key`：**这是整份实例的总钥匙**。它会派生出令牌签名密钥、密码胡椒与字段加密密钥。
  一旦公开，任何人都能离线爆破密码、伪造登录态、解密实名资料。

所以 `.gitignore` 默认忽略 `data/`。

如果你确实需要把一份「开箱即用」的实例随代码一起分发，请注意：
**必须接受这把主密钥是公开的**，并且要保证所有使用者都改了默认口令。
更稳妥的做法是只分发这份仓库，让使用者自己执行 `npm run fresh` —— 密钥与口令都只属于他那一份实例。

---

## 五、为什么用脚本生成，而不是直接打包一个 `.db` 文件

账号口令不是明文存的，而是 `bcrypt( sha256( 主密钥派生的胡椒 + 口令 ) )`。
这意味着：**换个主密钥，文档里写的口令就登不进去了**。

- 如果只发 `.db` 不发 `master.key`：文档里的口令永远登录失败；
- 如果连 `master.key` 一起发：等于公布了一把永久钥匙，且所有拿到它的人共享同一把密钥。

正确做法就是**在使用者本机生成**：`npm run fresh` 会为这一份实例生成专属主密钥，
并用它把文档中的口令哈希进去。这样文档里的口令一定能登录，密钥也不需要离开本机。

---

## 六、下一步

- 完整的功能说明、管理指南与安全设计见项目根目录的 [`README.md`](../README.md)
- 想调整注册开关、访客登录、身份验证、找回密码渠道：后台「站点与安全」
- 想开箱验证一遍安全能力：`npm start` 后再执行 `npm run verify`
