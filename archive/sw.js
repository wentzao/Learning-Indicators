const CACHE_NAME = 'learning-indicators-v1';
const IMAGES_CACHE = 'learning-indicators-images-v1';

// 動態獲取基礎路徑，適用於 GitHub Pages
const getBasePath = () => {
    // 從 Service Worker 的 location 獲取基礎路徑
    const swUrl = new URL(self.location);
    const pathSegments = swUrl.pathname.split('/');
    pathSegments.pop(); // 移除 sw.js
    return pathSegments.join('/') || '/';
};

const BASE_PATH = getBasePath();

// 要快取的核心文件 - 使用動態基礎路徑
const CORE_FILES = [
    BASE_PATH + '/',
    BASE_PATH + '/index.html',
    BASE_PATH + '/sw.js'
    // 可以添加其他核心CSS/JS文件
];

// 安裝事件
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching core files');
                return cache.addAll(CORE_FILES);
            })
            .then(() => {
                console.log('Service Worker: Core files cached');
                return self.skipWaiting(); // 立即激活新的SW
            })
    );
});

// 激活事件
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // 清理舊版本的快取
                    if (cacheName !== CACHE_NAME && cacheName !== IMAGES_CACHE) {
                        console.log('Service Worker: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker: Activated');
            return self.clients.claim(); // 立即控制所有頁面
        })
    );
});

// 攔截請求
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    
    // 只處理同源請求
    if (url.origin !== location.origin) {
        return;
    }
    
    // 圖片文件的快取策略 (Cache First)
    if (request.url.includes('/img/') && (request.url.endsWith('.png') || request.url.endsWith('.jpg') || request.url.endsWith('.jpeg'))) {
        event.respondWith(
            caches.open(IMAGES_CACHE)
                .then((cache) => {
                    return cache.match(request)
                        .then((cachedResponse) => {
                            if (cachedResponse) {
                                console.log('Service Worker: Serving image from cache:', request.url);
                                return cachedResponse;
                            }
                            
                            // 如果快取中沒有，從網路載入並快取
                            console.log('Service Worker: Fetching and caching image:', request.url);
                            return fetch(request)
                                .then((networkResponse) => {
                                    // 只快取成功的回應
                                    if (networkResponse.status === 200) {
                                        const responseToCache = networkResponse.clone();
                                        cache.put(request, responseToCache);
                                    }
                                    return networkResponse;
                                })
                                .catch(() => {
                                    // 網路失敗時，返回一個預設圖片或錯誤圖片
                                    console.log('Service Worker: Network failed for image:', request.url);
                                    return new Response(
                                        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect fill="#f0f0f0" width="200" height="120"/><text x="50%" y="50%" font-family="Arial" font-size="12" fill="#999" text-anchor="middle" dominant-baseline="middle">網路錯誤</text></svg>',
                                        {
                                            headers: {
                                                'Content-Type': 'image/svg+xml',
                                            },
                                        }
                                    );
                                });
                        });
                })
        );
    }
    // HTML文件的快取策略 (Network First)
    else if (request.destination === 'document') {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    // 網路成功，更新快取
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(request, responseToCache));
                    return networkResponse;
                })
                .catch(() => {
                    // 網路失敗，從快取提供
                    console.log('Service Worker: Network failed, serving from cache');
                    return caches.match(request);
                })
        );
    }
    // 其他資源使用預設行為
});

// 快取管理 API
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_IMAGES') {
        const imageUrls = event.data.urls;
        
        event.waitUntil(
            caches.open(IMAGES_CACHE)
                .then((cache) => {
                    console.log('Service Worker: Batch caching images...', imageUrls.length);
                    return Promise.all(
                        imageUrls.map((url) => {
                            return fetch(url)
                                .then((response) => {
                                    if (response.status === 200) {
                                        return cache.put(url, response.clone());
                                    }
                                })
                                .catch((error) => {
                                    console.warn('Service Worker: Failed to cache image:', url, error);
                                });
                        })
                    );
                })
                .then(() => {
                    console.log('Service Worker: Batch caching completed');
                    // 通知頁面快取完成
                    event.ports[0].postMessage({ success: true });
                })
                .catch((error) => {
                    console.error('Service Worker: Batch caching failed:', error);
                    event.ports[0].postMessage({ success: false, error });
                })
        );
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            Promise.all([
                caches.delete(CACHE_NAME),
                caches.delete(IMAGES_CACHE)
            ]).then(() => {
                console.log('Service Worker: All caches cleared');
                event.ports[0].postMessage({ success: true });
            })
        );
    }
}); 