@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   汉字小英雄 Hanzi Hero - 更新声音
echo ============================================
echo.
echo   游戏里已预生成 96 个常用字 + 200 多个高频字的真人级发音。
echo.
echo   如果你在「加自己的字」里加了生僻字，想让它们也用真人声音朗读：
echo     1) 在下面输入这些字（空格或逗号分隔），直接回车则只补齐缺失的
echo     2) 等待 1-2 分钟（会从微软云下载声音）
echo     3) 重新打开游戏即可
echo.
echo   需要：联网 + 已安装 Python 与 edge-tts
echo        pip install edge-tts
echo.
set /p extra=要补充的字：

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" (where py >nul 2>nul && set PY=py -3)
if "%PY%"=="" (
  echo.
  echo   [!] 没找到 Python。请先安装 Python 3，再执行：pip install edge-tts
  echo.
  pause
  exit /b 1
)

%PY% gen_audio.py --extra %extra%
echo.
pause
