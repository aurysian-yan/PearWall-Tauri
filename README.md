# Pear Wall

Pear Wall 是一个跨平台动态壁纸项目。本仓库维护桌面端、Wallpaper Engine 壁纸和共享 Rust 原生模块。

## 项目结构

```text
.
├── desktop/                # Tauri 桌面端及屏保打包脚本
│   ├── installer/          # Tauri Windows 自定义安装器
│   ├── scripts/            # 前端、macOS 屏保和 Windows 屏保构建脚本
│   └── src-tauri/          # Tauri Rust 宿主
├── wallpaper-engine/       # Wallpaper Engine 项目与共享 WebGL 渲染器
├── native/pearwall-core/   # 跨平台 Rust 音频分析核心
└── LICENSE                 # GPL-3.0 许可证
```

## 模块关系

- `desktop/` 构建前会把 `wallpaper-engine/` 的页面和资源复制到 `desktop/dist/`。
- `desktop/src-tauri/` 使用 `native/pearwall-core/` 提供音频分析能力。
- `desktop/dist/`、各模块的 `build/`、Rust `target/` 和 Node.js `node_modules/` 均为生成或依赖目录，不纳入版本控制。

## 桌面端开发

环境要求：Node.js、pnpm、Rust 和 Cargo。桌面端使用 Tauri 2。

安装桌面端依赖：

```bash
pnpm --dir desktop install
```

检查 Wallpaper Engine 脚本：

```bash
pnpm --dir wallpaper-engine run check
```

启动 Tauri 开发环境：

```bash
pnpm --dir desktop run dev
```

构建桌面应用：

```bash
pnpm --dir desktop run build
```

## 屏保构建

统一构建在 macOS 上运行，一次生成面向 macOS 15 及更高版本的 Apple Silicon App、`.saver`、DMG、Windows `.scr` 和自定义 UI 安装包。Windows 产物使用 `x86_64-pc-windows-msvc` 目标交叉编译。

首次构建需要安装 Xcode Command Line Tools、Windows 交叉编译工具和 DMG 工具：

```bash
xcode-select --install
brew install llvm create-dmg
cargo install --locked cargo-xwin
rustup target add aarch64-apple-darwin
rustup target add x86_64-pc-windows-msvc
```

检查构建环境：

```bash
pnpm --dir desktop run build:screen-savers:check
```

同时构建两个平台的屏保：

```bash
pnpm --dir desktop run build:screen-savers
```

产物统一输出到 `desktop/build/release/`：

```text
release/
├── macos/
│   ├── Pear Wall.app
│   ├── Pear Wall.saver
│   └── Pear-Wall-Screen-Saver-<version>.dmg
└── windows/
    ├── PearWall.scr
    └── Pear-Wall-Screen-Saver-<version>-setup.exe
```

Windows 安装包支持安装、更新、修复和卸载，并可选择在桌面和开始菜单中创建“启动屏幕保护程序”与“打开设置”两个快捷方式。

macOS DMG 同时包含 `Pear Wall.app` 和 `Pear Wall.saver`。App 负责完整设置与图片选择，Saver 负责系统屏保渲染；两者共享 `~/Library/Application Support/PearWall/settings.json`。

安装器动态背景可通过 Unsplash API 获取随机图片。在不会提交到 Git 的 `desktop/.env.local` 中配置凭据：

```dotenv
UNSPLASH_APPLICATION_ID=your_application_id
VITE_UNSPLASH_ACCESS_KEY=your_access_key
UNSPLASH_SECRET_KEY=your_secret_key
```

安装器前端只会读取带 `VITE_` 前缀的访问密钥。应用 ID 和秘密密钥仅保存在本地，不会进入前端安装包。未配置访问密钥或请求失败时，安装器会使用内置动态背景。

如需手动安装 `.scr`，可在管理员终端中将 `.scr` 和运行程序一起复制到系统目录：

```powershell
Copy-Item .\PearWall.scr "$env:WINDIR\System32\PearWall.scr"
Copy-Item .\PearWall.exe "$env:WINDIR\System32\PearWall.exe"
```

单独构建 macOS App、`.saver` 或 DMG：

```bash
pnpm --dir desktop run build:macos-app
pnpm --dir desktop run build:macos-saver
pnpm --dir desktop run build:dmg
```

macOS 构建默认使用 ad hoc 签名，用于本机开发和验证。对外分发时应指定 Developer ID Application 签名身份：

```bash
PEARWALL_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
  pnpm --dir desktop run build:dmg
```

`build:windows-scr` 仅用于把已经生成的 Windows Tauri 可执行文件整理为 `.scr`。

单独构建 Windows 安装包：

```bash
pnpm --dir desktop run build:windows-installer
```

## Wallpaper Engine

将 `wallpaper-engine/` 导入 Wallpaper Engine 编辑器即可预览和发布。项目参数配置位于 `wallpaper-engine/project.json`，渲染器和着色器分别位于 `wallpaper-engine/src/` 与 `wallpaper-engine/shaders/`。

## 版本与发布

```bash
pnpm --dir desktop version:check
pnpm --dir desktop version:set -- 0.1.3
```

提交到 `main` 后，GitHub Actions 会比较 `desktop/package.json` 的版本号。版本发生变化时，工作流会构建 Windows 安装程序、Windows 屏保、macOS App、macOS 屏保和 DMG，并创建对应的 GitHub Release。

Windows 代码签名可配置 `WINDOWS_CERTIFICATE_BASE64` 和 `WINDOWS_CERTIFICATE_PASSWORD`。macOS Developer ID 签名与公证可配置 `APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`。未配置签名凭据时仍会生成测试包。

## 官网

官网已拆分到 [PearWall-Website](https://github.com/aurysian-yan/PearWall-Website)。

## 许可证

本项目使用 GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
