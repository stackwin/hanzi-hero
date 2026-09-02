/* 小熊识字乐园 · Service Worker
 * 用途：让游戏在 iPad/手机浏览器里可以「添加到主屏幕」，离线也能玩。
 * 注意：file:// 协议下浏览器不注册 Service Worker（这是浏览器安全限制），
 *       因此双击 index.html 离线运行不受影响；SW 只在 http/https 下生效。
 */

const CACHE = "xiongshizi-v1";

/* 核心资源：应用外壳（首次 install 时全部预缓存） */
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
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 请求策略：核心资源 cache-first；音频 mp3 运行时缓存（用过的字以后离线也能听） */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isMp3 = url.pathname.toLowerCase().endsWith(".mp3");

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;

      return fetch(req).then((resp) => {
        // 只缓存成功响应；mp3 走 runtime 缓存
        if (resp && resp.ok && (isMp3 || url.origin === location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
        }
        return resp;
      }).catch(() => {
        // 离线且没缓存：返回一个空的音频响应，避免播放报错
        if (isMp3) return new Response(new ArrayBuffer(0), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
        throw new Error("offline");
      });
    })
  );
});
