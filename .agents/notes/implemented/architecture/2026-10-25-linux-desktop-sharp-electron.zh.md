# Agent Note: Linux 上 sharp 在 Electron 中使开发 Host 崩溃

Status: implemented

[English](2026-10-25-linux-desktop-sharp-electron.md) | 中文

## 问题

在 Linux 桌面开发启动中附加任何图像都会让 Host 子进程以 SIGSEGV 崩溃。Coredump 显示故障发生在 `@img/sharp-linux-x64` 的预编译绑定内部，位于一个 libuv worker 上，在 `metadata()` 执行期间调用了空指针——这正是 `dsh-attachment-local` 在接收图像时发出的第一个调用。Host 以 Electron 二进制的 Node 模式运行（`ELECTRON_RUN_AS_NODE=1`，`apps/desktop/src/node-environment.ts`），而 sharp 自带的 `[SharpElectronLinux]` 警告正指出了这一不兼容。图像字节本身无关紧要：在 Electron 下一行 `sharp(file).metadata()` 即可确定性地复现崩溃，而同一个 sharp 在普通 Node 下工作正常。

## 决策

Linux 开发启动不再解析工作区的预编译 `@img` 二进制，而是从一棵以系统 libvips 链接的源码构建树解析 sharp。

- `apps/desktop/scripts/prepare-sharp-electron.ts` 暂存固定版本的 sharp（固定版本读取自 `dsh-attachment-local`），以 `SHARP_FORCE_GLOBAL_LIBVIPS=1` 编译，在 `apps/desktop/.desktop-build/development/sharp-electron` 组装出自包含树，按 sharp 固定版本、Electron Node 版本与平台缓存，并在每次启动时在 Electron 下对崩溃路径做冒烟检查。
- `apps/desktop-host/src/sharp-electron.ts` 安装一个 `node:module` 的 `registerHooks` 解析器——即 `office-engine.ts` 的模式——在 Linux 上于 Electron 之下把所有落入工作区 `node_modules/sharp` 树的解析（裸说明符、子路径或已解析路径，因为 `require.resolve` 的输出会绕过说明符匹配）重定向到准备好的树，并在树缺失时让 Host 启动高声失败。macOS 与 Windows 不受影响：它们的 `@img` 预编译可用，且不存在 Linux 打包目标。

挑出系统 libvips 的证据：以预编译 `@img/sharp-libvips-linux-x64` 共享对象链接的全新编译绑定在 Electron 下仍然段错误，因此不兼容位于捆绑的 libvips/glib 对象中，而不是绑定的构建。同一构建链接发行版 libvips 8.18.7 后，在 Electron 与普通 Node 下都通过了完整的归一化路径（metadata、raw 解码、JPEG 质量阶梯、WebP）。

## 影响

Linux 桌面开发需要带头文件的 libvips（8.18.7 或更新版本）与 C++ 工具链，已写入开发指南前置条件与 Desktop README。准备好的树仅用于开发：打包运行时、CI 通道、Web、CLI 与普通 Node 测试继续使用工作区的预编译 sharp。首次准备会下载构建依赖并编译一次（约 2 分钟）；之后的启动复用缓存，仅重跑冒烟检查。由于 libvips 构建不同，Linux 桌面开发机上的编码输出字节可能与其他平台不同；快照与单元测试在普通 Node 下使用工作区 sharp，不受影响。

## 考虑过的替代方案

**以 Electron 头文件重建绑定。** N-API 保证了绑定的可移植性，而针对捆绑 libvips 对象的全新绑定仍然崩溃，因此头文件不是故障面。

**在 primary-runtime 的普通 Node 下运行 Linux 开发 Host。** 零编译，但 Linux 是开发启动中唯一直面该运行时特性的平台，这会使其不再检验 Electron RunAsNode。
