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
| Windows x64 NSIS installer | 94,838,255 bytes |

The installer is compressed. Its size is therefore much lower than the installed runtime size.

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

Both pruned packages are launched in CI with hardware rendering disabled. This verifies that Chromium's non-Vulkan software-rendering path still starts without the removed fallback files.

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

Removing these files would either break startup, remove audio support, eliminate the supported software-rendering path, weaken process isolation or diagnostics, or violate redistribution requirements.

## Permanent budgets

CI rejects a package when:

- `app.asar` exceeds 1 MiB;
- the Linux unpacked runtime exceeds 275,000,000 bytes;
- the Windows unpacked runtime exceeds 295,000,000 bytes;
- the Windows installer exceeds its configured release budget;
- any graphics file assigned to the pruning hook remains in the output.

A substantially smaller standalone installer would require maintaining a custom Electron/Chromium build or relying on a separately installed shared browser runtime. Apollo keeps the current upstream Electron runtime so security and maintenance updates remain practical and the installer remains self-contained.
