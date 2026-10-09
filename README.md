# 🎡 幸运转盘（Wheel Lottery）

一个**卡通简约风**的手机端转盘抽奖应用：自定义选项与概率、一键导入 Excel / Word / txt、本地保存。

移动端优先设计，手机上浏览器打开即可全屏使用，也支持"添加到主屏幕"当作 App 用（见下文）。

## 快速开始

1. 把整个 `wheel-lottery/` 目录拷到手机，用浏览器打开 `index.html`；
2. 或用任意静态服务器托管后访问（`npx serve wheel-lottery`、GitHub Pages / Cloudflare Pages 等）；
3. 在电脑上可以直接双击 `index.html` 本地预览。

> 提示：`.docx / .xlsx` 导入需要解析库，文件优先加载 `vendor/` 本地库（**完全离线可用**），本地库缺失时自动回退 CDN（需联网一次）。txt / csv 导入始终离线可用。

## 功能

| 功能 | 说明 |
|------|------|
| 🌀 转盘抽奖 | 点中央「开抽」按钮，5–8 圈缓动动画，抽中金色高亮 + 提示音 + 震动 |
| ⚖️ 概率自定义 | 每个选项一个**权重**数字，权重占比 = 该扇区概率；「均分」一键让所有选项概率相等 |
| 🏷️ 自定义标签 | 列表里直接改名称、删改选项、随时添加，全部自动保存到本地（localStorage） |
| 📚 方案库 | 把当前配置存成命名方案（快照），下次一键「▶ 调用」还原；可存多套互不干扰，最多 30 个 |
| 📥 一键导入 | txt / csv / Excel / Word 均可导入，可"替换现有"或"追加到末尾" |
| 🌈 换色 | 「换色」随机分配马卡龙配色，也可在代码 `PALETTE` 里改默认色板 |
| 📱 手机适配 | 触控优化、刘海屏安全区、无外部字体/图片依赖 |

## 📄 导入格式说明

点击主界面「📥 导入」按钮，弹窗里也有同样的说明。

### txt / csv（最简单）

每行一个选项；空行和 `#` 开头的行为注释，自动忽略。

```
吃饭=3        ← 名称=权重（概率是其他项的 3 倍）
睡觉          ← 不写权重则视为 1（与其他项均分）
学习,2        ← 逗号也行
锻炼|4        ← 竖线也行
# 这是一条注释，会被跳过
```

权重支持小数（如 `唱歌=1.5`）。名称里可以带空格、标点。

### Excel（.xlsx / .xls）

读**第一个工作表**：
- **A 列**：选项名称（必填）
- **B 列**：权重（可空，默认 1）
- 第一行如果是"名称 / 选项 / 内容 / label / name"这类表头，会被自动跳过。

| 名称 | 权重 |
|------|------|
| 吃饭 | 3 |
| 睡觉 | 1 |
| 学习 | 2 |

### Word（.docx）

每个**段落**一个选项（换行即分隔），也支持行内权重写法：

```
吃饭=3
睡觉
学习,2
```

> 不支持旧版 `.doc` 二进制格式，请另存为 `.docx`。

### 通用规则

- 权重必须是正数，非法或空则按 1 处理；
- 分隔符支持 `=`、`，` `,`、`|`（全角半角皆可）；
- 最多 60 个选项（转盘太密就不好看了）。

## 技术说明

- 纯前端，无构建步骤：`index.html` + `style.css` + `parser.js`（导入解析纯函数）+ `app.js`（主逻辑）+ `vendor/`（离线解析库）。
- 概率实现：扇区角度 = 权重占比；抽奖按权重加权随机选中扇区，指针停在该扇区内的随机位置（20%~80% 区间，避开边缘），显示与概率严格一致。
- 数据存 `localStorage`（键 `wheel-items-v1`），重开不丢；方案库存 `wheel-presets-v1`。
- `parser.js` 可在 Node 里单测（工作区为 `type:module`，用 `.cjs` require 后读 `globalThis.WheelParser`）。

## 📦 打包成 Android APK

仓库自带手工构建脚本，**不需要 Gradle、不需要联网**（只用 Android SDK 的 aapt2/d8/apksigner 和 JDK）。

```powershell
cd android
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-apk.ps1
# 产物：android/dist/wheel-lottery.apk
```

安装到手机（数据线连上、手机开 USB 调试后）：

```powershell
adb install -r android\dist\wheel-lottery.apk
```

也可以直接把 APK 传到手机，用文件管理器点击安装（需允许"安装未知来源应用"）。

**实现说明**：

- `android/java/com/luckywheel/MainActivity.java` 是一个 WebView 壳。Web 内容从 `assets/www/` 通过 `shouldInterceptRequest` 映射到虚拟 `https://wheel.local` 源——**不用 `file:///android_asset`**，因为 file:// 的 origin 不稳定，localStorage 会在重启后丢失，用户的选项就没了。
- 实现了 `onShowFileChooser`，否则「导入」按钮点了没反应；并在 `file.name` 缺失时退回 MIME 判断扩展名（Android 通过 `content://` 选文件常常拿不到文件名）。
- 构建脚本带**构建后自检**：条目名出现反斜杠、或缺少 `AndroidManifest.xml` / `classes.dex` / 任一 web 资源，直接构建失败——防止"编译通过但装上白屏"的 APK 流出。
- 签名用的是自动生成的 **调试签名**（`android/keystore/`，已 gitignore）。要上架应用商店需换成自己的 release keystore。
- 改动网页代码后重新跑一次构建脚本即可，APK 会覆盖更新（签名一致才能覆盖安装）。

## 目录结构

```
wheel-lottery/
├── index.html            # 入口页面（含页面结构、导入格式弹窗）
├── style.css             # 卡通简约样式
├── parser.js             # txt/csv/Excel/Word 解析（纯函数）
├── app.js                # 转盘绘制、抽奖动画、交互、localStorage
├── vendor/               # xlsx / jszip 本地库（离线导入用）
├── push.bat              # 一键提交 + 推送 GitHub
└── android/              # APK 构建（无需 Gradle）
    ├── build-apk.ps1     # 构建脚本
    ├── AndroidManifest.xml
    ├── java/             # WebView 壳源码
    ├── res/drawable/     # 应用图标（vector）
    └── dist/             # 构建产物（gitignored）
```

## 其他打包方式

- **PWA**："添加到主屏幕"即可全屏运行 + 桌面图标，无需安装包。
- **iOS**：用 Capacitor 或 Tauri Mobile 包一层即可，网页代码无需改动。
- **Android**：直接用上面的 `build-apk.ps1`，或改用 Gradle + Capacitor 走标准 Android 工程。