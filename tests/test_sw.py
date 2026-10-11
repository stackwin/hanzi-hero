# -*- coding: utf-8 -*-
"""Service Worker 更新策略测试。

为什么必须有这一条：
  曾经出过的 bug —— sw.js 文件内容一字未改，浏览器做字节比对后认为「SW 没更新」，
  于是永远不重新安装；再加上 cache-first 策略，旧的 index.html 就被永久钉死在缓存里。
  结果就是：GitHub Pages 明明已经更新，iPad 刷新几十遍还是老版本。

本用例会在本地起一个 http 服务器（SW 只在 http/https 下生效，file:// 不行），验证：
  1. 首屏拿到的就是磁盘上的最新文件；
  2. SW 能注册成功，并建出当前版本号的缓存；
  3. 缓存里的 index.html / css / js 是可用的；
  4. **改了文件、刷新就能看到新内容**（网络优先策略生效，不被缓存挡住）；
  5. 断网后刷新，游戏仍然打得开（PWA 离线可用）。

用法：
    python tests/test_sw.py
"""
from __future__ import annotations

import functools
import http.server
import pathlib
import re
import sys
import threading

TESTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))

from _common import BASE, SHOTS, launch_browser  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PROBE_NAME = "__sw_probe__.txt"
PROBE = BASE / PROBE_NAME


class _Quiet(http.server.SimpleHTTPRequestHandler):
    """关掉逐条请求日志，免得刷屏。"""

    def log_message(self, *args):
        pass

    def end_headers(self):
        # 模拟 GitHub Pages：静态资源带缓存头。SW 必须靠 no-cache 强制回源才能穿透它
        self.send_header("Cache-Control", "max-age=600")
        super().end_headers()


def start_server():
    handler = functools.partial(_Quiet, directory=str(BASE))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def read_sw_version() -> str:
    src = (BASE / "sw.js").read_text(encoding="utf-8")
    m = re.search(r'const\s+VERSION\s*=\s*"([^"]+)"', src)
    if not m:
        sys.exit("[!] sw.js 里找不到 VERSION 常量")
    return m.group(1)


def main() -> int:
    fails: list[str] = []
    version = read_sw_version()
    cache_name = "xiongshizi-" + version
    print(f"sw.js 版本号：{version}  →  期望缓存名：{cache_name}\n")

    # 静态检查：策略必须是网络优先且不吃 HTTP 缓存，否则又会踩旧坑
    sw_src = (BASE / "sw.js").read_text(encoding="utf-8")
    if 'cache: "no-store"' not in sw_src:
        fails.append("sw.js 没有使用 no-store 网络优先策略，可能被 HTTP 缓存挡住更新")
    if "cache-first" not in sw_src or "isMp3" not in sw_src:
        fails.append("sw.js 缺少 mp3 缓存优先分支，离线听不到声音")
    if "skipWaiting" not in sw_src or "clients.claim" not in sw_src:
        fails.append("sw.js 缺少 skipWaiting / clients.claim，新版本无法立即接管")

    httpd = start_server()
    port = httpd.server_address[1]
    base_url = f"http://127.0.0.1:{port}/"
    print(f"本地服务器：{base_url}\n")

    try:
        with sync_playwright() as pw:
            browser = launch_browser(pw, headless=True)
            ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                      service_workers="allow")
            errors: list[str] = []
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

            # ---------- 1. 首屏是磁盘上的最新版 ----------
            page.goto(base_url)
            page.wait_for_selector("#screenHome:not(.hidden)")
            modes = page.evaluate(
                "() => [...document.querySelectorAll('.mode-card')].map(e => e.dataset.mode)")
            levels = page.evaluate("() => document.querySelectorAll('.level-card').length")
            print(f"— 首屏 —")
            print(f"  玩法卡片 {len(modes)} 张：{modes}")
            print(f"  关卡卡片 {levels} 个")
            if "picture" not in modes:
                fails.append("首屏没有「看图选字」玩法卡片，说明拿到的不是最新 index.html")
            if len(modes) != 5:
                fails.append(f"玩法卡片应为 5 张，实际 {len(modes)} 张")
            if levels < 8:
                fails.append(f"关卡应至少 8 个，实际 {levels} 个")

            # ---------- 2. SW 注册并接管 ----------
            page.wait_for_function(
                "() => navigator.serviceWorker && navigator.serviceWorker.controller",
                timeout=20000)
            state = page.evaluate(
                "async () => { const r = await navigator.serviceWorker.ready;"
                " return r.active ? r.active.state : 'none'; }")
            print(f"\n— Service Worker —")
            print(f"  注册状态：{state}，已接管当前页面 ✓")
            if state != "activated":
                fails.append(f"SW 状态异常：{state}")

            # ---------- 3. 缓存内容 ----------
            keys = page.evaluate("() => caches.keys()")
            print(f"  缓存列表：{keys}")
            if cache_name not in keys:
                fails.append(f"没有建出当前版本缓存 {cache_name}")
            stale = [k for k in keys if k.startswith("xiongshizi-") and k != cache_name]
            if stale:
                fails.append(f"旧版本缓存没被清掉：{stale}")

            entries = page.evaluate(
                "async (n) => { const c = await caches.open(n);"
                " const ks = await c.keys();"
                " return ks.map(r => new URL(r.url).pathname); }", cache_name)
            need = ["/index.html", "/css/style.css", "/js/game.js", "/js/data.js", "/manifest.json"]
            missing = [n for n in need if not any(e.endswith(n) for e in entries)]
            print(f"  已缓存 {len(entries)} 条资源")
            if missing:
                fails.append(f"核心资源没进缓存：{missing}")

            # ---------- 4. 改了文件，刷新就能看到（核心回归点）----------
            print(f"\n— 更新可见性（本次修复的关键）—")
            PROBE.write_text("AAA", encoding="utf-8")
            got1 = page.evaluate("async () => (await fetch('" + PROBE_NAME + "')).text()")
            print(f"  写入 AAA → 页面读到 {got1!r}")
            PROBE.write_text("BBB", encoding="utf-8")
            got2 = page.evaluate("async () => (await fetch('" + PROBE_NAME + "')).text()")
            print(f"  改成 BBB → 页面读到 {got2!r}")
            if got2 != "BBB":
                fails.append(f"文件改了但页面仍拿到旧内容（{got2!r}），网络优先策略没生效")
            else:
                print("  ✓ 同 URL 也能拿到最新内容，不会被缓存钉死")

            # ---------- 5. 离线仍可玩 ----------
            print(f"\n— 离线可用性 —")
            ctx.set_offline(True)
            try:
                page.reload()
                page.wait_for_selector("#screenHome:not(.hidden)", timeout=20000)
                offline_modes = page.evaluate(
                    "() => document.querySelectorAll('.mode-card').length")
                print(f"  断网刷新：页面正常渲染，玩法卡片 {offline_modes} 张 ✓")
                if offline_modes != 5:
                    fails.append(f"离线时玩法卡片只有 {offline_modes} 张，缓存不完整")
                SHOTS.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(SHOTS / "60_sw_offline.png"), full_page=True)
            except Exception as e:
                fails.append(f"断网后页面打不开：{e}")
                print(f"  ✗ 断网刷新失败：{e}")
            finally:
                ctx.set_offline(False)

            if errors:
                print(f"\n— JS 错误 {len(errors)} 条 —")
                for e in errors:
                    print(f"  {e}")
                fails.append(f"出现 {len(errors)} 条 JS 错误")

            browser.close()
    finally:
        httpd.shutdown()
        # 清理探针文件与其缓存项
        try:
            PROBE.unlink(missing_ok=True)
        except Exception:
            pass

    print("\n" + "=" * 56)
    if fails:
        print("结果：不通过")
        for f in fails:
            print(f"  ✗ {f}")
        return 1
    print("结果：全部通过 ✓")
    print("  · 首屏即最新版 · SW 正常接管 · 缓存无旧版残留")
    print("  · 改文件刷新即可见 · 断网仍可玩 · 0 JS 错误")
    return 0


if __name__ == "__main__":
    sys.exit(main())
