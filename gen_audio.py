# -*- coding: utf-8 -*-
"""
为识字游戏预生成微软云神经网络女声的 mp3。

用法：
    python gen_audio.py                 # 生成（已有文件会跳过）
    python gen_audio.py --force         # 全部重新生成
    python gen_audio.py --extra 猫 狗   # 追加指定汉字
    python gen_audio.py --voices xiaoxiao   # 只生成某一个声音

生成的音频放在 audio/<voice>/ 下，映射表写进 js/audiomanifest.js（JS 文件，
这样 file:// 直接双击打开 index.html 也能加载，不会被 CORS 拦）。
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = os.path.join(BASE, "audio")
MANIFEST = os.path.join(BASE, "js", "audiomanifest.js")
import shutil

# 用 node 加载 data.js 提取字库。自动找系统里的 node，找不到就退回正则解析。
NODE = shutil.which("node") or shutil.which("node.exe") or "node"

# 两个微软云普通话女声
VOICES = {
    "xiaoxiao": {"short": "zh-CN-XiaoxiaoNeural", "label": "☁️ 云朵姐姐（温柔甜美）"},
    "xiaoyi":   {"short": "zh-CN-XiaoyiNeural",   "label": "🌸 小樱姐姐（活泼可爱）"},
}

# 小学一年级高频字，覆盖家长在自定义字库里可能加的字
EXTRA_CHARS = (
    "猫狗兔鸡鸭鹅虎象熊猴鹿马牛羊猪鼠鸟鱼虫花草木叶果米面饭菜肉蛋奶茶水火土"
    "爸妈爷奶哥姐弟妹叔姨舅孙娃童友师生医工农兵司机船车飞走跑跳坐站爬睡醒"
    "读写画唱听说看想爱笑哭喜怒乐苦甜酸辣咸香臭美丑新旧老幼高矮胖瘦长短"
    "东西南北左右前后里外中上下大小多少好坏了不没很太真全对"
    "春夏秋冬年季月日时分秒早中晚夜明暗冷热暖凉干湿"
    "我你他她它们这那儿哪什么谁怎么几两半千百万元角"
    "家国学校班级门窗桌椅床被衣裤鞋帽袜包伞灯扇钟表镜"
    "天地太阳星云风雨雪电冰雷彩虹路桥街市场店院园池海江河湖波浪"
    "红黄蓝绿白黑灰紫粉金银彩画字纸笔本书报刀尺盒球琴鼓"
    "身体头脸眼耳口牙手脚腿背心肚血汗毛发力气病药"
)

# 界面里的固定句子 / 句子片段（拼名字用）
PHRASES = [
    "声音打开啦",
    "全部答对，",
    "完成啦，",
    "真棒",
    "你好，我们一起认字吧",
    "远宝",
    "我们一起来认字吧",
    "点一点，听一听",
    "找一找，在哪里",
    "把一样的字连起来",
    "选一个吧",
    "答对了",
    "再试一次",
    "真厉害",
    "好棒好棒",
    "继续加油",
]


def load_bank():
    """用 node 加载 data.js，拿到字库（比正则靠谱）。"""
    js = os.path.join(BASE, "js", "data.js")
    script = (
        "global.window={};"
        "require(%s);"
        "process.stdout.write(JSON.stringify("
        "{bank:global.window.WORD_BANK,"
        "praise:global.window.PRAISE,"
        "cheer:global.window.CHEER}));"
        % json.dumps(js.replace("\\", "/"))
    )
    try:
        out = subprocess.check_output([NODE, "-e", script], cwd=BASE)
        return json.loads(out.decode("utf-8"))
    except Exception:
        # 没装 node 也能跑：退回正则解析 data.js
        src = open(js, encoding="utf-8").read()
        chars = re.findall(r"\{\s*c:\s*'([^']+)'", src)
        praise = re.search(r"window\.PRAISE\s*=\s*\[([^\]]*)\]", src)
        cheer = re.search(r"window\.CHEER\s*=\s*\[([^\]]*)\]", src)
        return {
            "bank": [{"chars": [{"c": c} for c in chars]}],
            "praise": re.findall(r"'([^']+)'", praise.group(1)) if praise else [],
            "cheer": re.findall(r"'([^']+)'", cheer.group(1)) if cheer else [],
        }


def collect_texts(extra):
    """汇总全部要配音的文本，按顺序返回（去重保序）。"""
    seen, texts = set(), []

    def add(t):
        t = (t or "").strip()
        if t and t not in seen:
            seen.add(t)
            texts.append(t)

    data = load_bank()
    chars, words = [], []
    for lv in data["bank"]:
        for c in lv["chars"]:
            chars.append(c["c"])
            words.extend(c.get("w") or [])
    print(f"  字库：{len(chars)} 个单字，{len(words)} 个组词")

    for t in chars:
        add(t)
    for t in words:
        add(t)
    for t in data.get("praise") or []:
        add(t)
    for t in data.get("cheer") or []:
        add(t)
    for t in PHRASES:
        add(t)
    for t in EXTRA_CHARS:
        add(t)
    # 用户在命令行 / bat 里传的"字"：只保留汉字，其他字符（字母数字等）会读出来很怪
    for t in extra:
        cleaned = "".join(ch for ch in t if '\u4e00' <= ch <= '\u9fff')
        add(cleaned)

    return texts, chars


def fname(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12] + ".mp3"


async def synth_one(comm, text, voice_short, out_path, rate, pitch, sem, retries=3):
    async with sem:
        for attempt in range(retries):
            try:
                c = edge_tts.Communicate(text, voice_short, rate=rate, pitch=pitch)
                await c.save(out_path)
                if os.path.getsize(out_path) > 900:   # 太小说明是空音频/报错
                    return True
                raise RuntimeError("音频过小")
            except Exception as e:
                if attempt == retries - 1:
                    print(f"    [失败] {text} -> {e}")
                    if os.path.exists(out_path):
                        os.remove(out_path)
                    return False
                await asyncio.sleep(1.5 * (attempt + 1))
        return False


def read_manifest():
    """读回已有的 audiomanifest.js，保留已生成的映射。"""
    if not os.path.exists(MANIFEST):
        return {}
    try:
        raw = open(MANIFEST, encoding="utf-8").read()
        m = re.search(r"window\.AUDIO_MANIFEST\s*=\s*(\{.*\})\s*;?\s*$", raw, re.S)
        return json.loads(m.group(1)) if m else {}
    except Exception:
        return {}


def write_manifest(manifest):
    body = json.dumps(manifest, ensure_ascii=False, indent=1)
    open(MANIFEST, "w", encoding="utf-8").write(
        "/* 自动生成，请勿手改。重新生成：python gen_audio.py */\n"
        "window.AUDIO_MANIFEST = " + body + ";\n"
    )


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略已有文件，全部重生成")
    ap.add_argument("--extra", nargs="*", default=[], help="追加的汉字")
    ap.add_argument("--voices", nargs="*", default=list(VOICES), choices=list(VOICES))
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    print("收集待配音文本…")
    texts, chars = collect_texts(args.extra)
    print(f"  合计 {len(texts)} 条\n")

    manifest = read_manifest()
    sem = asyncio.Semaphore(args.concurrency)

    for vkey in args.voices:
        cfg = VOICES[vkey]
        vdir = os.path.join(AUDIO_DIR, vkey)
        os.makedirs(vdir, exist_ok=True)

        entry = manifest.get(vkey) or {
            "label": cfg["label"], "dir": "audio/%s/" % vkey, "map": {}
        }
        entry["label"], entry["dir"] = cfg["label"], "audio/%s/" % vkey
        vmap = entry.setdefault("map", {})

        todo = []
        for t in texts:
            fn = fname(t)
            path = os.path.join(vdir, fn)
            # vmap 的 key 是文本、value 才是文件名，别写成 `fn not in vmap`
            if args.force or not os.path.exists(path) or vmap.get(t) != fn:
                todo.append((t, fn, path))

        print(f"[{cfg['short']}] 待生成 {len(todo)} 条（已存在 {len(texts)-len(todo)} 条）")
        if not todo:
            manifest[vkey] = entry
            continue

        tasks = []
        for t, fn, path in todo:
            # 单字念慢一点、更清楚；词句按自然语速
            if len(t) == 1:
                rate, pitch = "-20%", "+12Hz"
            else:
                rate, pitch = "-12%", "+10Hz"
            tasks.append(synth_one(None, t, cfg["short"], path, rate, pitch, sem))

        results = await asyncio.gather(*tasks)
        ok = sum(1 for r in results if r)
        for (t, fn, _), r in zip(todo, results):
            if r:
                vmap[t] = fn
        print(f"  完成 {ok}/{len(todo)}" + ("  ⚠️ 有失败项" if ok < len(todo) else "  ✓"))
        manifest[vkey] = entry

    write_manifest(manifest)
    total = sum(len(v.get("map", {})) for v in manifest.values())
    size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(AUDIO_DIR) for f in fs
    )
    print(f"\n映射表已写入 js/audiomanifest.js —— 共 {total} 条")
    print(f"音频体积合计 {size/1024/1024:.1f} MB")


if __name__ == "__main__":
    import edge_tts
    asyncio.run(main())
