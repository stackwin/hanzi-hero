# 测试说明

游戏本身是纯静态页面，跑起来不需要任何依赖。这里的测试是给**改代码的人**用的：
改完跑一遍，确认没把已经做好的功能弄坏。

> 标题写「三个用例」是历史遗留，现在实际是**五个用例**（陆续加了 PWA 触控 `test_pwa.py`、
> Service Worker 更新策略 `test_sw.py`）。

## 安装

```bash
pip install -r tests/requirements.txt
python -m playwright install chromium     # 没有 Edge/Chrome 时才需要
```

## 跑测试

```bash
python tests/run_all.py            # 全部（约 3-5 分钟）
python tests/run_all.py --quick    # 快速回归（只跑 2 关）
```

也可以单独跑：

```bash
python tests/test_e2e.py                       # 主流程：8 关 × 5 玩法 + 家长面板
python tests/test_e2e.py --headed              # 显示浏览器界面，肉眼调试
python tests/test_e2e.py --levels 2 --modes learn listen
python tests/test_audio.py                     # 朗读走的是云音频还是系统机械音
python tests/test_weak_char.py --samples 150   # 错题优先机制是否生效
python tests/test_pwa.py                       # PWA 文件/字段 + CSS 触控 + has_touch 触屏仿真
python tests/test_sw.py                        # SW 更新策略：改文件刷新即见新版 + 断网可玩
python tests/list_voices.py                    # 诊断：列出系统可用中文语音
```

退出码 `0` = 通过，`1` = 失败。

## 五个用例分别在验什么

| 用例 | 验的东西 | 失败意味着 |
|---|---|---|
| `test_e2e.py` | 8 关 × 5 玩法能跑通、结算页正常、家长面板数据齐全、**全程无 JS 错误** | 改坏了主流程 |
| `test_audio.py` | 每次朗读都命中 `audio/` 下的预生成云音频，**系统 TTS 调用次数必须为 0**；切换声音后路径跟着变 | 云音频没接上，孩子会听到机械音 |
| `test_weak_char.py` | 错得多的字出现率显著高于随机基准（约 8.3%）；答对后错题权重会衰减；家长面板能列出易错字 | 复习机制失效 |
| `test_pwa.py` | `manifest.json`/`sw.js`/图标齐全、字段正确；CSS 触控属性到位、hover 已收进 `(hover:hover)`；用 `has_touch` 触屏仿真跑通学一学+听音选字 | PWA 或 iPad 触控适配没接上 |
| `test_sw.py` | 本地起 http 服务器：首屏即最新版、SW 正常接管、无旧版缓存残留、**改了文件刷新就拿到新内容**、断网仍可玩 | 老版本会被永久缓存钉死，服务器更新了用户也看不到 |

## 设计约定

- **不写死本机路径**：根目录由 `_common.py` 相对定位，换台电脑照样跑。
- **浏览器自动探测**：依次尝试 Edge → Chrome → Playwright 自带 Chromium。
- **用 `file://` 直接打开**，不起本地服务器 —— 和孩子双击打开的方式完全一致，
  能测出 CORS 之类只在 `file://` 下才暴露的问题。
  （唯一例外是 `test_sw.py`：Service Worker 在 `file://` 下根本不注册，
  所以它自己在进程内起一个 `http://127.0.0.1` 的临时服务器。）
- **任何 JS 报错都算失败**：`Harness` 会收集 console error 和 pageerror。
  历史上就是靠这条抓到过 `var Audio = {}` 遮蔽全局构造函数导致云音频静默失效的 bug。
- 截图产物在 `tests/shots/`，已被 `.gitignore` 忽略。

## 想加新用例

照着现有文件抄一个，`from _common import` 拿现成的操作封装
（`open_level` / `start_mode` / `play_find` / `handle_mini` / `Harness.seed` ...），
最后加进 `run_all.py` 的 `SUITES` 列表。
