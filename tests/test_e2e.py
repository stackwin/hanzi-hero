# -*- coding: utf-8 -*-
"""端到端冒烟测试：5 关 × 4 玩法全部跑一遍 + 家长面板 + 复习小游戏截图。

用法：
    python tests/test_e2e.py              # 无头跑，只报结论
    python tests/test_e2e.py --headed     # 看得见界面（调试用）
    python tests/test_e2e.py --levels 2   # 只跑前 2 关，快速验证
"""
from __future__ import annotations

import argparse
import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("[!] 缺 playwright。执行：pip install -r tests/requirements.txt")

from _common import (Harness, MINI_SEEN, back_home, handle_mini, launch_browser,
                     open_level, quit_game, start_mode, unlock_all, PLAYERS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true", help="显示浏览器界面")
    ap.add_argument("--levels", type=int, default=5, help="跑前 N 关（默认 5）")
    ap.add_argument("--modes", nargs="*", default=list(PLAYERS), choices=list(PLAYERS))
    args = ap.parse_args()

    stats = {"levels": 0, "modes": 0, "minis": []}

    with sync_playwright() as pw:
        browser = launch_browser(pw, headless=not args.headed)
        h = Harness.new(browser)
        h.goto()
        h.shot("01_home")
        print(f"首页标题：{h.page.locator('#homeTitle').inner_text()}")

        unlock_all(h)
        print("已解锁全部关卡")

        for lv in range(args.levels):
            if not open_level(h, lv):
                print(f"  跳过第 {lv + 1} 关（被锁或不存在）")
                continue
            stats["levels"] += 1
            title = h.page.locator("#levelTitle").inner_text()
            print(f"\n第 {lv + 1} 关：{title}")
            h.shot(f"10_level{lv + 1}")

            for mode in args.modes:
                start_mode(h, mode)
                PLAYERS[mode](h)
                stats["modes"] += 1
                done = h.visible("#screenResult")
                star = h.page.locator("#sessionStar").inner_text()
                print(f"  {'OK ' if done else '?? '}{mode:<7} 结算页={done}  本局星星={star}")
                if done and mode == args.modes[0] and lv == 0:
                    h.shot("20_result")

                # 复习小游戏可能在结算前的任何一步弹出，补一次检查
                skin = handle_mini(h)
                if skin:
                    stats["minis"].append(skin)

                back_home(h)
                if not open_level(h, lv):
                    break

        # 家长面板
        h.page.click("#btnParent")
        h.page.wait_for_selector("#screenParent:not(.hidden)")
        cells = h.count("#masteryGrid .mcell")
        weak = h.count("#weakGrid .wcell")
        voices = h.count("#voiceCards .vcard")
        h.shot("30_parent")
        print(f"\n家长面板：认识度格子 {cells} 个，易错字 {weak} 个，声音卡片 {voices} 张")

        browser.close()

    print("\n" + "=" * 46)
    seen = sorted(set(MINI_SEEN))
    print(f"\n复习小游戏：共触发 {len(MINI_SEEN)} 次，皮肤 {seen or '（没遇到）'}")
    print(f"关卡 {stats['levels']} 个 / 玩法局数 {stats['modes']} 局")
    if h.errors:
        print(f"[失败] 捕获 {len(h.errors)} 条 JS 错误：")
        h.dump_errors()
        return 1
    print("[通过] 无 JS 错误。截图见 tests/shots/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
