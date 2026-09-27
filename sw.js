/* Service Worker —— 离线缓存所有静态资源 */
'use strict';

const CACHE_NAME = 'purine-app-v1.0.5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './data/purine-db.js',
  './data/knowledge.js',
  './data/pinyin-map.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './lib/qrcode.min.js',
  './lib/jsqr.js',
  './lib/pako.min.js'
];

// 安装：预缓存核心资源
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 缓存优先，网络兜底；跨域请求直接走网络
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN 更新下载等走网络
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
