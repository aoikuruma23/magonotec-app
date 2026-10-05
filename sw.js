/**
 * まごのTEC Service Worker（STEP25: 朝8時 Push通知）
 *
 * - push: 「おはよう！ 今日も元気？」を表示
 * - notificationclick: まごのTEC のホームを開く（開いていればそのウィンドウを前に出す）
 *
 * GitHub Pages では https://aoikuruma23.github.io/magonotec-app/sw.js に置かれ、
 * scope は /magonotec-app/ になる。開くURLは scope から作るので、パスを直書きしない。
 *
 * ※ fetch のキャッシュはしない（アプリの更新がすぐ届くように）
 */

const DEFAULT_TITLE = 'おはよう！';
const DEFAULT_BODY = '今日も元気？';
const ICON_URL = 'assets/magonotec/logo/logo_magonotec_pink.png';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const icon = new URL(ICON_URL, self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title || DEFAULT_TITLE, {
      body: data.body || DEFAULT_BODY,
      icon: icon,
      badge: icon,
      tag: 'genki-morning', // 同じ朝に2回届いても1つにまとめる
      renotify: true,
      lang: 'ja',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // ホーム（https://aoikuruma23.github.io/magonotec-app/）
  const homeUrl = self.registration.scope;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(homeUrl) && 'focus' in client) {
        // 開いている画面へ「ホームを出して」と伝える（main.js が受け取る）
        client.postMessage({ type: 'open-home' });
        return client.focus();
      }
    }
    return self.clients.openWindow(homeUrl);
  })());
});
