# -*- coding: utf-8 -*-
"""测试公共工具：路径解析、浏览器启动、错误收集、游戏操作封装。

设计原则：
  1. 所有测试都用 file:// 直接打开游戏根目录的 index.html，不需要起本地服务器；
  2. 不写死任何本机路径 —— 浏览器依次尝试 Edge → Chrome → Playwright 自带 Chromium；
  3. 每个用例都收集浏览器 console error / pageerror，任何 JS 报错都算失败。
"""
from __future__ import annotations

import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent.parent      # 游戏根目录
INDEX = BASE / "index.html"
TESTS = pathlib.Path(__file__).resolve().parent
SHOTS = TESTS / "shots"                                    # 截图产物，已在 .gitignore 里忽略

# 浏览器优先级：Edge（Windows 自带、中文语音最全）→ Chrome → 自带 Chromium
CHANNELS = ("msedge", "chrome", None)

STORAGE_KEY = "kids-shizi-v1"


def game_url() -> str:
    if not INDEX.exists():
        sys.exit(f"[!] 找不到游戏入口：{INDEX}")
    return INDEX.as_uri()


def launch_browser(pw, headless: bool = True, slow_mo: int = 0):
    """按 CHANNELS 顺序尝试启动浏览器，返回第一个可用的。"""
    for ch in CHANNELS:
        try:
            return pw.chromium.launch(headless=headless, slow_mo=slow_mo,
                                      **({"channel": ch} if ch else {}))
        except Exception:
            continue
    sys.exit("[!] 没有可用浏览器。先执行：python -m playwright install chromium")


class Harness:
    """包住 page，负责错误收集与截图。"""

    def __init__(self, page):
        self.page = page
        self.errors: list[str] = []

    @classmethod
    def new(cls, browser, init_script: str | None = None, viewport=(1280, 900)):
        ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        if init_script:
            # 必须在建 page 之前注入，否则首屏脚本已经跑完了
            ctx.add_init_script(init_script)
        page = ctx.new_page()
        h = cls(page)
        page.on("console", lambda m: h.errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: h.errors.append(f"pageerror: {e}"))
        return h

    # ---- 基础 ----
    def goto(self):
        self.page.goto(game_url())
        self.page.wait_for_selector("#screenHome:not(.hidden)")

    def shot(self, name: str):
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

    def visible(self, sel: str) -> bool:
        """元素存在且可见（游戏用 .hidden 切屏，光 count() 判断不够）。"""
        return self.page.evaluate(
            "s => { const e = document.querySelector(s);"
            " return !!(e && !e.classList.contains('hidden')"
            " && e.getBoundingClientRect().height > 0); }", sel)

    def count(self, sel: str) -> int:
        return self.page.locator(sel).count()

    def ok(self) -> bool:
        return not self.errors

    def dump_errors(self):
        for e in self.errors:
            print(f"    [JS 错误] {e}")

    def seed(self, state: dict, reload: bool = True):
        """往 localStorage 写一份存档，用来构造测试前置条件。"""
        import json
        self.page.evaluate(
            "([k, v]) => localStorage.setItem(k, v)",
            [STORAGE_KEY, json.dumps(state, ensure_ascii=False)])
        if reload:
            self.page.reload()
            self.page.wait_for_selector("#screenHome:not(.hidden)")


# ---------------------------------------------------------------- 游戏操作

def unlock_all(h: Harness):
    """家长面板里勾上「解锁全部关卡」，省得一关关打过来。"""
    p = h.page
    p.click("#btnParent")
    p.wait_for_selector("#screenParent:not(.hidden)")
    p.evaluate("document.getElementById('chkUnlock').click()")
    p.click("#btnParentBack")
    p.wait_for_selector("#screenHome:not(.hidden)")


def open_level(h: Harness, idx: int):
    """打开第 idx 关（0 起）。返回是否成功（关卡被锁时返回 False）。"""
    p = h.page
    if not h.visible("#screenHome"):
        p.click("#btnHome")
        p.wait_for_selector("#screenHome:not(.hidden)")
    card = p.locator(".level-card").nth(idx)
    if card.count() == 0:
        return False
    if "locked" in (card.get_attribute("class") or ""):
        return False
    # 用 JS 触发点击，绕开 .level-card:hover 的 transform 造成的"元素不稳定"死循环
    p.evaluate(f"document.querySelectorAll('.level-card')[{idx}].click()")
    p.wait_for_selector("#screenLevel:not(.hidden)")
    return True


def start_mode(h: Harness, mode: str):
    # 用 JS 触发点击，绕开 .mode-card:hover 的 translateY 造成的"元素不稳定"死循环
    h.page.evaluate(
        f"document.querySelector('.mode-card[data-mode=\"{mode}\"]').click()"
    )
    h.page.wait_for_selector("#screenGame:not(.hidden)")


def quit_game(h: Harness):
    """退出当前玩法，回到关卡页。"""
    p = h.page
    if h.visible("#screenGame"):
        # 先清掉可能挡住按钮的复习小游戏
        p.evaluate("document.querySelectorAll('.mini-overlay').forEach(o => o.remove())")
        p.evaluate("document.getElementById('btnQuit').click()")
        p.wait_for_selector("#screenLevel:not(.hidden)")


def back_home(h: Harness):
    p = h.page
    p.evaluate("document.querySelectorAll('.mini-overlay').forEach(o => o.remove())")
    p.evaluate("document.getElementById('btnHome').click()")
    p.wait_for_selector("#screenHome:not(.hidden)")


MINI_SKINS = {"balloon-field": "balloon", "mole-field": "mole", "apple-field": "apple"}
MINI_SEEN: list[str] = []      # 本次运行实际遇到过的复习小游戏皮肤


def handle_mini(h: Harness, shot_prefix: str = "mini"):
    """如果复习小游戏弹出来了，就截个图并把它处理掉。

    返回皮肤名（balloon / mole / apple）或 None。优先点正确的那个，
    点不出来再点右下角「跳过 ↪」。
    """
    p = h.page
    if h.count(".mini-overlay") == 0:
        return None

    kind = "mini"
    for cls, name in MINI_SKINS.items():
        if h.count(f".mini-overlay .{cls}") > 0:
            kind = name
            break
    MINI_SEEN.append(kind)
    h.shot(f"{shot_prefix}_{kind}")

    items = p.locator(".mini-overlay [data-c]")
    for i in range(items.count()):
        try:
            items.nth(i).click(timeout=1200)
        except Exception:
            continue
        p.wait_for_timeout(250)
        if h.count(".mini-overlay") == 0:
            return kind
    if h.count(".mini-overlay") > 0:
        p.evaluate("document.getElementById('miniSkip')?.click()")
        p.wait_for_timeout(400)
    if h.count(".mini-overlay") > 0:
        p.evaluate("document.querySelectorAll('.mini-overlay').forEach(o => o.remove())")
    return kind


def _result_visible(h: Harness) -> bool:
    return h.visible("#screenResult")


def play_learn(h: Harness):
    """学一学：点卡片听读音，一路点「下一个 →」到结算。"""
    p = h.page
    for _ in range(40):
        if _result_visible(h):
            return
        if handle_mini(h):
            continue
        nxt = p.locator("#nextCard")
        if nxt.count() == 0:
            break
        p.evaluate("document.getElementById('flashCard')?.click()")   # 触发一次朗读
        p.wait_for_timeout(200)
        p.evaluate("document.getElementById('nextCard').click()")
        p.wait_for_timeout(320)


def play_listen(h: Harness):
    """听音选字：挨个选项点，点到出现 .opt.right 为止。"""
    p = h.page
    for _ in range(60):
        if _result_visible(h):
            return
        if handle_mini(h):
            continue
        if p.locator("#spkBtn").count() > 0:
            p.evaluate("document.getElementById('spkBtn').click()")
            p.wait_for_timeout(150)
        opts = p.locator(".opt")
        if opts.count() == 0:
            break
        for i in range(opts.count()):
            try:
                opts.nth(i).click(timeout=1200)
            except Exception:
                continue
            p.wait_for_timeout(200)
            if h.count(".opt.right") > 0:
                break
        p.wait_for_timeout(1600)   # 等自动进入下一题


def play_find(h: Harness):
    """找字游戏：直接点 data-ok=1 的格子（每轮 3 个）。"""
    p = h.page
    for _ in range(40):
        if _result_visible(h):
            return
        if handle_mini(h):
            continue
        cells = p.locator('.cell[data-ok="1"]')
        if cells.count() == 0:
            break
        for i in range(cells.count()):
            try:
                cells.nth(i).click(timeout=1200)
            except Exception:
                continue
            p.wait_for_timeout(180)
        p.wait_for_timeout(1300)


def play_match(h: Harness):
    """配对游戏：按 data-key 把「字」(type=c) 和「图」(type=e) 配起来。"""
    p = h.page
    for _ in range(40):
        if _result_visible(h):
            return
        if handle_mini(h):
            continue
        cards = p.locator(".mcard:not(.done)")
        n = cards.count()
        if n == 0:
            break
        groups: dict[str, dict[str, str]] = {}
        for i in range(n):
            c = cards.nth(i)
            key = c.get_attribute("data-key")
            typ = c.get_attribute("data-type")
            groups.setdefault(key, {})[typ] = str(i)
        paired = False
        for key, g in groups.items():
            if "c" in g and "e" in g:
                try:
                    p.evaluate(
                        "([a, b]) => { const cs = document.querySelectorAll('.mcard');"
                        " cs[a].click(); cs[b].click(); }",
                        [int(g["c"]), int(g["e"])])
                except Exception:
                    continue
                p.wait_for_timeout(700)
                paired = True
                break
        if not paired:
            break
    p.wait_for_timeout(1200)


PLAYERS = {"learn": play_learn, "listen": play_listen, "find": play_find, "match": play_match}
