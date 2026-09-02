# -*- coding: utf-8 -*-
"""诊断小工具：列出当前系统 / 浏览器里可用的中文朗读语音。

游戏默认用预生成的云音频（audio/ 目录），系统语音只在云音频没覆盖到时兜底。
想知道兜底音质如何、或者想换系统语音时，跑这个看看有哪些可选。

用法：
    python tests/list_voices.py
"""
from __future__ import annotations

import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("[!] 缺 playwright。执行：pip install -r tests/requirements.txt")

from _common import Harness, launch_browser

# 语音列表是异步加载的，要等 voiceschanged 事件
PROBE = """
() => new Promise(resolve => {
  const dump = () => resolve(speechSynthesis.getVoices()
    .filter(v => (v.lang || '').toLowerCase().startsWith('zh'))
    .map(v => ({ name: v.name, lang: v.lang, local: v.localService,
                 uri: v.voiceURI, def: v.default })));
  if (speechSynthesis.getVoices().length) return dump();
  speechSynthesis.onvoiceschanged = dump;
  setTimeout(dump, 3000);
})
"""


def main() -> int:
    with sync_playwright() as pw:
        browser = launch_browser(pw, headless=True)
        h = Harness.new(browser)
        h.goto()
        voices = h.page.evaluate(PROBE)
        browser.close()

    if not voices:
        print("[!] 没找到任何中文语音。这只影响云音频没覆盖到的生僻字。")
        return 0

    print(f"共 {len(voices)} 个中文语音（local=true 是本机机械音，false 多为在线神经网络音）：\n")
    for v in voices:
        tag = "本地" if v["local"] else "在线"
        mark = " ← 默认" if v["def"] else ""
        print(f"  [{tag}] {v['name']:<34} {v['lang']}{mark}")
    print("\n提示：游戏主要用 audio/ 下的云音频，这里列的是兜底方案。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
