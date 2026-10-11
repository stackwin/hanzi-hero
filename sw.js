/* 小熊识字乐园 · Service Worker
 * 用途：让游戏在 iPad/手机浏览器里可以「添加到主屏幕」，离线也能玩。
 * 注意：file:// 协议下浏览器不注册 Service Worker（这是浏览器安全限制），
 *       因此双击 index.html 离线运行不受影响；SW 只在 http/https 下生效。
 *
 * ⚠️ 每次发版改了 index.html / css / js，都要把下面的 VERSION 加一。
 *    浏览器是靠「sw.js 文件内容有没有变」来判断要不要更新的——
 *    内容一字不改，它就认为 SW 没变，永远不重新安装，用户也就永远看到旧版。
 */

const VERSION = "v2";
const CACHE = "xiongshizi-" + VERSION;

/* 核心资源：应用外壳（首次 install 时预缓存，用于离线打开） */
const CORE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/data.js",
  "./js/audiomanifest.js",
  "./js/audio.js",
  "./js/game.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐条缓存：某一条失败（比如临时网络抖动）不至于整个 install 失败
      await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
      await self.skipWaiting(); // 新 SW 立即进入等待转激活，不等旧标签页关闭
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清掉所有旧版本缓存（v1 里那份过期的 index.html 就是这么被干掉的）
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim(); // 立即接管已经打开的页面
    })()
  );
});

/* 请求策略
 *  1) mp3 音频      —— cache-first。文件名是文本内容的 md5，内容永不改变，
 *                      缓存最省流量，且离线也能听。
 *  2) 其余同源资源  —— network-first + no-store。每次都拿完整的新响应，
 *                      拿起就顺手更新缓存；断网时才回落到缓存。
 *
 *   这里为什么用 no-store 而不是 no-cache：no-cache 只是「回服务器问一句」，
 *   服务器若回 304（HTTP 缓存仍有效）浏览器就会继续用旧的。而有些服务器
 *   （含本地 python -m http.server）判断文件变没变只看秒级的 mtime 和大小，
 *   判断错就会一直回 304，于是又变成「明明改了却拿着旧版」——正是我们要根除的病。
 *   no-store 直接绕过 HTTP 缓存，不给这种误判留机会。离线性由下面的 Cache Storage 保证，
 *   与 HTTP 缓存无关。
 *
 *  3) 跨域请求      —— 放行，交给浏览器默认处理。
 */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isMp3 = url.pathname.toLowerCase().endsWith(".mp3");

  // 1) 音频：缓存优先
  if (isMp3) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              const clone = resp.clone();
              caches.open(CACHE).then((cache) => cache.put(req, clone));
            }
            return resp;
          })
          .catch(() => {
            // 离线且没缓存过：返回空音频，避免播放报错打断游戏
            return new Response(new ArrayBuffer(0), {
              status: 200,
              headers: { "Content-Type": "audio/mpeg" }
            });
          });
      })
    );
    return;
  }

  // 3) 跨域：不接管
  if (!sameOrigin) return;

  // 2) 同源资源：网络优先（no-store 保证不吃 HTTP 缓存），离线回落缓存
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((resp) => {
        if (resp && resp.ok && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
        }
        return resp;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // 直接输网址打开（导航请求）时，兜底给预缓存的主页
        if (req.mode === "navigate") {
          const home = await caches.match("./index.html");
          if (home) return home;
        }
        return new Response("", { status: 504, statusText: "offline" });
      })
  );
});
