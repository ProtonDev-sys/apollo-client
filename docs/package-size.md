# Electron Package Size

Apollo's application payload is small. Most of a distributable desktop package is the Electron runtime: Chromium, Node.js, JavaScript engine snapshots, internationalization data, media codecs, graphics libraries, process-sandbox support, and required license notices.

## Current measured output

The package pipeline measures real release output on Linux and Windows:

| Output | Size |
|---|---:|
| Generated Apollo runtime | 383,218 bytes |
| Linux `app.asar` | 387,146 bytes |
| Windows `app.asar` | 387,165 bytes |
| Linux x64 unpacked runtime | 273,060,493 bytes |
| Windows x64 unpacked runtime | 292,748,743 bytes |
| Windows x64 NSIS installer | 94,838,251 bytes |
| Windows x64 portable 7-Zip archive | 76,758,470 bytes |

The installer and portable archive contain the same compact Electron core. The installer provides the normal Windows installation flow. The portable archive is a solid LZMA2 archive that is 19.1% smaller than the installer and must be extracted before use.

Relative to the original 103,878,207-byte installer, the compact installer is 8.7% smaller and the portable archive is 26.1% smaller.

## Removed Electron components

Apollo does not use WebGPU or Vulkan rendering. The main process disables those Chromium features before Electron becomes ready, and the Electron Builder `afterPack` hook removes their unused prebuilt runtime files.

Windows removes:

- `dxcompiler.dll`
- `dxil.dll`
- `vk_swiftshader.dll`
- `vk_swiftshader_icd.json`
- `vulkan-1.dll`

This removes 33,540,586 bytes from the unpacked Windows runtime.

Linux removes:

- `libvk_swiftshader.so`
- `vk_swiftshader_icd.json`
- `libvulkan.so.1`

This removes 7,137,811 bytes from the unpacked Linux runtime.

Both pruned packages are launched in CI through the normal graphics path and again with `--disable-gpu`. The portable archive is also extracted and launched before it is accepted as a release artifact.

## Optional integrations

The core installer and portable archive do not build or bundle the optional Discord Social SDK helper. Rich Presence uses Apollo's small built-in Discord IPC implementation and requires no production package dependency.

The SDK-backed Social helper is isolated to `npm run build:win:social`. This keeps normal distributions independent of locally supplied SDK binaries and prevents optional native payloads from silently increasing the core download.

## Components retained deliberately

The package keeps:

- the Electron and Chromium executable;
- Chromium resource archives;
- ICU internationalization data;
- V8 startup snapshots;
- FFmpeg media support required for music playback;
- ANGLE/OpenGL rendering libraries;
- the Chromium sandbox and crash handler;
- the English locale;
- Electron and Chromium license notices.

Removing these files would either break startup, remove audio support, eliminate the retained software-rendering path, weaken process isolation or diagnostics, or violate redistribution requirements.

## Distribution commands

```powershell
npm run build:win           # compact core installer
npm run build:win:portable  # 7-Zip portable archive
npm run build:win:social    # installer with locally built optional Social SDK helper
```

`npm run build:win:portable` uses `scripts/build-windows-portable.js`, solid LZMA2 compression, and a 78,000,000-byte archive limit.

## Permanent budgets

CI rejects a package when:

- the generated Apollo runtime reaches 512 KiB;
- `app.asar` exceeds 1 MiB;
- the Linux unpacked runtime exceeds 275,000,000 bytes;
- the Windows unpacked runtime exceeds 295,000,000 bytes;
- the Windows installer exceeds 96,000,000 bytes;
- the Windows portable archive exceeds 78,000,000 bytes;
- any graphics file assigned to the pruning hook remains in the output;
- the default Windows build starts including the optional Discord Social SDK.

A substantially smaller self-contained package would require maintaining a custom Electron/Chromium build or relying on a separately installed shared browser runtime. Apollo keeps the upstream Electron runtime so security updates, media playback, process isolation, and maintenance remain practical.
