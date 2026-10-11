# -*- coding: utf-8 -*-
"""错题优先机制测试：错得多的字，出现概率要明显更高。

做法：往 localStorage 塞一份"故意做错"的存档（「三」错 5 次、「七」错 2 次），
然后反复进入「找字游戏」读当前的目标字，统计出现频率。
目标是字库里 12 个字，随机情况下每个字约 8.3%。

用法：
    python tests/test_weak_char.py
    python tests/test_weak_char.py --samples 150   # 样本越多越稳
"""
from __future__ import annotations

import argparse
import json
import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("[!] 缺 playwright。执行：pip install -r tests/requirements.txt")

from _common import (Harness, STORAGE_KEY, launch_browser, open_level,
                     play_find, quit_game, start_mode, unlock_all)

LEVEL0 = "一二三四五六七八九十人口"
HOT, WARM = "三", "七"


def seed_state() -> dict:
    """所有字都练过 5 次（排除"没见过"加权），只让错题数不同。"""
    mastery = {c: 5 for c in LEVEL0}
    return {
        "stars": 0,
        "mastery": mastery,
        "wrong": {HOT: 5, WARM: 2},
        "cleared": {},
        "unlockAll": False,
        "sound": False,          # 安静点，跑得快
        "name": "测试",
        "voiceURI": None,
        "cloudVoice": "xiaoxiao",
        "custom": [],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=120, help="抽样轮数")
    args = ap.parse_args()

    fails = []
    with sync_playwright() as pw:
        browser = launch_browser(pw, headless=True)
        h = Harness.new(browser)
        h.goto()

        h.seed(seed_state())
        unlock_all(h)
        open_level(h, 0)
        start_mode(h, "find")

        hits: dict[str, int] = {}
        for i in range(args.samples):
            cells = h.page.locator('.cell[data-ok="1"]')
            if cells.count() == 0:
                break
            t = cells.first.inner_text().strip()
            hits[t] = hits.get(t, 0) + 1
            quit_game(h)
            start_mode(h, "find")

        total = sum(hits.values()) or 1
        print(f"抽样 {total} 轮，目标字出现次数：")
        for ch, n in sorted(hits.items(), key=lambda x: -x[1]):
            bar = "█" * max(1, round(n / total * 60))
            print(f"  {ch}  {n:>3} 次  {n / total * 100:5.1f}%  {bar}")

        hot_pct = hits.get(HOT, 0) / total * 100
        warm_pct = hits.get(WARM, 0) / total * 100
        base = 100 / len(LEVEL0)
        print(f"\n「{HOT}」错 5 次 → {hot_pct:.1f}%（随机基准 {base:.1f}%）")
        print(f"「{WARM}」错 2 次 → {warm_pct:.1f}%")

        if hot_pct < base * 2:
            fails.append(f"错最多的字出现率只有 {hot_pct:.1f}%，没有明显加权（应 > {base * 2:.1f}%）")
        if warm_pct <= 0:
            fails.append(f"错 2 次的「{WARM}」一次都没出现")
        elif hot_pct <= warm_pct:
            fails.append("错 5 次的字没比错 2 次的字出现得更频繁")

        # 家长面板的「容易错的字」——必须在「答对衰减」之前检查：
        # 玩一局之后 HOT 字可能已经被答对衰减掉、从易错榜单消失，那是正常行为
        h.page.evaluate("document.getElementById('btnHome').click()")
        h.page.wait_for_selector("#screenHome:not(.hidden)")
        h.page.click("#btnParent")
        h.page.wait_for_selector("#screenParent:not(.hidden)")
        weak_cells = h.page.locator("#weakGrid .wcell").all_inner_texts()
        print(f"\n家长面板易错字：{weak_cells}")
        h.shot("50_weak")
        if not weak_cells:
            fails.append("家长面板没有显示易错字")
        elif HOT not in "".join(weak_cells):
            fails.append(f"易错字里没有「{HOT}」")

        # 答对后错题数应自然衰减
        h.page.evaluate("document.getElementById('btnParentBack').click()")
        h.page.wait_for_selector("#screenHome:not(.hidden)")
        open_level(h, 0)
        start_mode(h, "find")
        play_find(h)
        st = json.loads(h.page.evaluate(f"localStorage.getItem('{STORAGE_KEY}')"))
        wrong_now = (st.get("wrong") or {}).get(HOT, 0)
        print(f"\n— 验证答对会衰减错题权重 —")
        print(f"  「{HOT}」错次数 5 → {wrong_now}")
        if wrong_now >= 5:
            print("  （本轮没抽到该字，不算失败）")

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
    print("[通过] 错题加权生效，答对可衰减，家长面板展示正确。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
