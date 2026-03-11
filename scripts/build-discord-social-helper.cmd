@echo off
setlocal

set ROOT=%~dp0..
set OUT_DIR=%ROOT%\native-bin\win32-x64
set SDK_DIR=%APOLLO_DISCORD_SOCIAL_SDK_DIR%
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe

if "%SDK_DIR%"=="" set SDK_DIR=%ROOT%\vendor\discord_social_sdk
if not exist "%SDK_DIR%\include\cdiscord.h" (
  if exist "%ROOT%\SDK\discord_social_sdk\include\cdiscord.h" (
    set SDK_DIR=%ROOT%\SDK\discord_social_sdk
  )
)

if not exist "%SDK_DIR%\include\cdiscord.h" (
  echo Discord Social SDK headers were not found.
  echo Set APOLLO_DISCORD_SOCIAL_SDK_DIR to a local Discord Social SDK checkout
  echo or place the SDK at %ROOT%\vendor\discord_social_sdk.
  exit /b 1
)

set VS_INSTALL_DIR=
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set VS_INSTALL_DIR=%%I
  )
)

if "%VS_INSTALL_DIR%"=="" if defined VSINSTALLDIR set VS_INSTALL_DIR=%VSINSTALLDIR%
if "%VS_INSTALL_DIR%"=="" (
  echo Visual Studio C++ build tools were not found.
  echo Install Visual Studio Build Tools with the Desktop development with C++ workload.
  exit /b 1
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

call "%VS_INSTALL_DIR%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1

cl /nologo /std:c++17 /EHsc /MD ^
  /I "%SDK_DIR%\include" ^
  "%ROOT%\native-src\discord-social-helper.cpp" ^
  /link ^
  /LIBPATH:"%SDK_DIR%\lib\release" ^
  /OUT:"%OUT_DIR%\discord-social-helper.exe" ^
  discord_partner_sdk.lib ^
  Crypt32.lib
if errorlevel 1 exit /b 1

copy /Y "%SDK_DIR%\bin\release\discord_partner_sdk.dll" "%OUT_DIR%\discord_partner_sdk.dll" >nul
if errorlevel 1 exit /b 1

exit /b 0
