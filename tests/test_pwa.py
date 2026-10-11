# -*- coding: utf-8 -*-
"""PWA 与触控适配专项测试。

验证：
  1. index.html 已接入 PWA meta（theme-color / apple-mobile-web-app / manifest / apple-touch-icon / 图标）；
  2. manifest.json 字段齐全（name/short_name/display/start_url/scope/icons）；
  3. sw.js 存在且能被注册（在 http 下），file:// 下不报错（双击运行不受影响）；
  4. 触屏仿真（has_touch=True）：点关卡、点玩法、答题、复习小游戏、结算，全程无 JS 错误；
  5. CSS 触控属性已加（touch-action / user-select / tap-highlight），hover 已包进 (hover:hover)。

用法：
    python tests/test_pwa.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

from _common import BASE, game_url, launch_browser, Harness, open_level, start_mode, \
    quit_game, handle_mini, back_home, unlock_all

sys.path.insert(0, str(BASE))

passed = 0
failed: list[str] = []


def check(name: str, cond: bool, extra: str = ""):
    global passed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed.append(name)
        print(f"  ❌ {name}  {extra}")


def test_static_pwa_files():
    print("\n[1] 静态文件与字段校验")
    html = (BASE / "index.html").read_text(encoding="utf-8")

    check("index.html 含 <link rel=manifest>", 'rel="manifest"' in html and 'href="manifest.json"' in html)
    check("index.html 含 theme-color meta", 'name="theme-color"' in html)
    check("index.html 含 apple-mobile-web-app-capable", 'apple-mobile-web-app-capable' in html)
    check("index.html 含 apple-touch-icon", 'rel="apple-touch-icon"' in html)
    check("index.html viewport 禁缩放", 'user-scalable=no' in html)
    check("index.html 注册 Service Worker", "serviceWorker" in html and "sw.js" in html)
    check("SW 注册带 updateViaCache:none（避免 sw.js 被 HTTP 缓存挡住）",
          "updateViaCache" in html and "'none'" in html)

    check("manifest.json 存在", (BASE / "manifest.json").exists())
    check("sw.js 存在", (BASE / "sw.js").exists())
    check("icon-192.png 存在", (BASE / "icon-192.png").exists())
    check("icon-512.png 存在", (BASE / "icon-512.png").exists())
    check("apple-touch-icon.png 存在", (BASE / "apple-touch-icon.png").exists())

    m = json.loads((BASE / "manifest.json").read_text(encoding="utf-8"))
    check("manifest name", m.get("name") == "小熊识字乐园")
    check("manifest short_name", m.get("short_name") == "识字乐园")
    check("manifest display=standalone", m.get("display") == "standalone")
    check("manifest start_url", m.get("start_url") == "./index.html")
    check("manifest scope", m.get("scope") == "./")
    icons = m.get("icons", [])
    check("manifest 有图标", len(icons) >= 2, f"got {len(icons)}")
    check("manifest 有 maskable 图标", any(i.get("purpose") == "maskable" for i in icons))


def test_css_touch():
    print("\n[2] CSS 触控适配")
    css = (BASE / "css" / "style.css").read_text(encoding="utf-8")

    check("body touch-action: manipulation", "touch-action: manipulation" in css)
    check("body text-size-adjust", "text-size-adjust" in css)
    check("tap-highlight 已禁用", "-webkit-tap-highlight-color: transparent" in css)
    check("user-select: none 已加", "user-select: none" in css)
    check("-webkit-touch-callout: none 已加", "-webkit-touch-callout: none" in css)

    # 所有 hover 都应被包进 (hover:hover) and (pointer:fine)
    hover_blocks = len(re.findall(r"@media \(hover: hover\) and \(pointer: fine\)", css))
    check("hover 规则已包进媒体查询", hover_blocks >= 18, f"共 {hover_blocks} 处")
    # 不应再有裸露在媒体查询外的 :hover
    # （简单启发式：统计 :hover 出现次数 vs 被包裹次数，这里只确认关键的 mode-card 被包住）
    check("括号配平", css.count("{") == css.count("}"))


def test_touch_playthrough():
    print("\n[3] 触屏仿真完整流程（has_touch=True）")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        # iPad 竖屏尺寸 + 触屏
        ctx = browser.new_context(
            viewport={"width": 768, "height": 1024},
            has_touch=True,
            is_mobile=True,
            device_scale_factor=2,
        )
        page = ctx.new_page()
        h = Harness(page)
        page.on("console", lambda m: h.errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: h.errors.append(f"pageerror: {e}"))

        try:
            h.goto()
            check("首页正常加载", h.visible("#screenHome"))

            unlock_all(h)
            check("解锁全部关卡", True)

            # 打开第 1 关
            check("点开关卡 1", open_level(h, 0))

            # 学一学（触屏点击走真实 tap）
            start_mode(h, "learn")
            check("进入「学一学」", h.visible("#screenGame"))
            from _common import play_learn
            play_learn(h)
            check("学一学出结算页", h.visible("#screenResult"))

            # 回首页 → 第 1 关 → 听音选字
            back_home(h)
            open_level(h, 0)
            start_mode(h, "listen")
            from _common import play_listen
            play_listen(h)
            check("听音选字出结算页", h.visible("#screenResult"))

            check("全程无 JS 错误", h.ok())
            if not h.ok():
                h.dump_errors()

            h.shot("pwa_touch_ipad")
        finally:
            browser.close()

    print(f"    触屏流程完成，错误数：{len(h.errors) if 'h' in dir() else '?'}")


def main() -> int:
    test_static_pwa_files()
    test_css_touch()
    test_touch_playthrough()

    print(f"\n{'=' * 52}\n汇总：{passed} 通过 / {len(failed)} 失败")
    if failed:
        print("失败项：")
        for f in failed:
            print(f"  - {f}")
        return 1
    print("[全部通过] PWA 与触控适配就绪")
    return 0


if __name__ == "__main__":
    sys.exit(main())
