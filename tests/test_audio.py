# -*- coding: utf-8 -*-
"""音频链路测试：确认游戏播的是预生成的云音频，而不是系统机械音。

做法是在页面脚本执行前插桩：
  - 包装 window.Audio      → 每 new 一次就 +1，并记录 mp3 路径
  - 包装 speechSynthesis.speak → 每读一次就 +1（这个数应该恒为 0）

用法：
    python tests/test_audio.py
"""
from __future__ import annotations

import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("[!] 缺 playwright。执行：pip install -r tests/requirements.txt")

from _common import Harness, launch_browser, open_level, start_mode, unlock_all

# 必须在页面脚本之前注入，否则 audio.js 已经拿到了原始的 Audio 引用
INSTRUMENT = r"""
window.__audio = { cloud: 0, tts: 0, urls: [] };
(function () {
  var Orig = window.Audio;
  function Patched(src) {
    window.__audio.cloud++;
    window.__audio.urls.push(String(src || ''));
    return new Orig(src);
  }
  Patched.prototype = Orig.prototype;
  window.Audio = Patched;

  var synth = window.speechSynthesis;
  if (synth) {
    var orig = synth.speak.bind(synth);
    synth.speak = function (u) { window.__audio.tts++; return orig(u); };
  }
})();
"""


def counts(h: Harness) -> dict:
    return h.page.evaluate("window.__audio")


def main() -> int:
    fails = []
    with sync_playwright() as pw:
        browser = launch_browser(pw, headless=True)
        h = Harness.new(browser, init_script=INSTRUMENT)

        # 有头浏览器才真的解码音频；无头下 play() 可能被拦，但计数逻辑照样能验
        h.goto()
        unlock_all(h)

        print("— 默认声音（云朵姐姐 xiaoxiao）—")
        open_level(h, 0)
        start_mode(h, "learn")
        h.page.evaluate("document.getElementById('flashCard').click()")
        h.page.wait_for_timeout(2500)
        c1 = counts(h)
        print(f"  云音频播放 {c1['cloud']} 次，系统 TTS {c1['tts']} 次")
        if c1["cloud"] == 0:
            fails.append("云音频一次都没播（检查 audio/ 目录和 js/audiomanifest.js 是否齐全）")
        if c1["tts"] != 0:
            fails.append(f"回退到了系统机械音 {c1['tts']} 次")
        xiao_urls = [u for u in c1["urls"] if "/xiaoxiao/" in u]
        print(f"  路径样例：{xiao_urls[0].split('/')[-3:] if xiao_urls else '（无）'}")
        if not xiao_urls:
            fails.append("默认声音不是 xiaoxiao")

        # 切到小樱姐姐
        print("\n— 切换到小樱姐姐（xiaoyi）—")
        h.page.evaluate("document.getElementById('btnQuit').click()")
        h.page.wait_for_selector("#screenLevel:not(.hidden)")
        h.page.evaluate("document.getElementById('btnHome').click()")
        h.page.wait_for_selector("#screenHome:not(.hidden)")
        h.page.click("#btnParent")
        h.page.wait_for_selector("#screenParent:not(.hidden)")
        h.page.evaluate("document.querySelector('.vcard[data-v=\"xiaoyi\"]').click()")
        h.page.wait_for_timeout(400)
        cur = h.page.locator("#voiceStatus").inner_text()
        print(f"  {cur}")
        h.shot("40_voice_xiaoyi")

        h.page.click("#btnParentBack")
        h.page.wait_for_selector("#screenHome:not(.hidden)")
        h.page.evaluate("window.__audio.cloud = 0; window.__audio.urls = [];")
        open_level(h, 0)
        start_mode(h, "learn")
        h.page.evaluate("document.getElementById('flashCard').click()")
        h.page.wait_for_timeout(2500)
        c2 = counts(h)
        yi_urls = [u for u in c2["urls"] if "/xiaoyi/" in u]
        print(f"  云音频播放 {c2['cloud']} 次，其中 xiaoyi 路径 {len(yi_urls)} 条")
        if not yi_urls:
            fails.append("切换声音后没有走 xiaoyi 目录")

        browser.close()

    print("\n" + "=" * 46)
    if h.errors:
        fails.append(f"{len(h.errors)} 条 JS 错误")
        h.dump_errors()
    if fails:
        print("[失败]")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("[通过] 朗读全部走预生成的云音频，0 次系统机械音，声音切换生效。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
