# Pear Wall

Pear Wall 是一个跨平台动态壁纸项目。本仓库维护桌面端、Wallpaper Engine 壁纸和共享 Rust 原生模块。

## 项目结构

```text
.
├── desktop/                # Tauri 桌面端及屏保打包脚本
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

统一构建在 macOS 上运行，一次生成 macOS `.saver`、屏保 DMG 和 Windows `.scr`，不生成 Windows 安装包。

首次构建需要安装 Xcode Command Line Tools、Windows 交叉编译工具和 DMG 工具：

```bash
xcode-select --install
brew install llvm create-dmg
cargo install --locked cargo-xwin
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
│   ├── Pear Wall.saver
│   └── Pear-Wall-Screen-Saver-<version>.dmg
└── windows/
    └── PearWall.scr
```

Windows 屏保可在管理员终端中复制到系统目录：

```powershell
Copy-Item .\PearWall.scr "$env:WINDIR\System32\PearWall.scr"
```

单独构建 macOS `.saver` 或 DMG：

```bash
pnpm --dir desktop run build:macos-saver
pnpm --dir desktop run build:dmg
```

`build:windows-scr` 仅用于把已经生成的 Windows Tauri 可执行文件整理为 `.scr`。

## Wallpaper Engine

将 `wallpaper-engine/` 导入 Wallpaper Engine 编辑器即可预览和发布。项目参数配置位于 `wallpaper-engine/project.json`，渲染器和着色器分别位于 `wallpaper-engine/src/` 与 `wallpaper-engine/shaders/`。

## 许可证

本项目使用 GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
