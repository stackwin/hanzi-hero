# -*- coding: utf-8 -*-
"""一键跑全部测试，最后汇总通过/失败。

用法：
    python tests/run_all.py            # 全跑（约 3-5 分钟）
    python tests/run_all.py --quick    # 只跑 2 关，快速回归
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from _common import TESTS

SUITES = [
    ("主流程冒烟", ["test_e2e.py"]),
    ("音频链路", ["test_audio.py"]),
    ("错题优先机制", ["test_weak_char.py"]),
    ("PWA 与触控", ["test_pwa.py"]),
]


def run(name: str, args: list[str]) -> tuple[bool, float]:
    print(f"\n{'=' * 52}\n▶ {name}\n{'=' * 52}")
    t0 = time.time()
    r = subprocess.run([sys.executable, str(TESTS / args[0])] + args[1:],
                       cwd=str(TESTS), encoding="utf-8", errors="replace")
    return r.returncode == 0, time.time() - t0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="只跑 2 关，快速回归")
    args = ap.parse_args()

    results = []
    for name, base in SUITES:
        extra = ["--levels", "2"] if (args.quick and name == "主流程冒烟") else []
        ok, secs = run(name, base + extra)
        results.append((name, ok, secs))

    print(f"\n{'=' * 52}\n汇总\n{'=' * 52}")
    for name, ok, secs in results:
        print(f"  {'✅ 通过' if ok else '❌ 失败'}  {name:<16} {secs:5.1f}s")

    bad = [n for n, ok, _ in results if not ok]
    print()
    if bad:
        print(f"[失败] {len(bad)} 个用例没过：{'、'.join(bad)}")
        return 1
    print(f"[全部通过] {len(results)} 个用例。截图见 tests/shots/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
