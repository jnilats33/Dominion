// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase Konfiguration für den Service Worker
firebase.initializeApp({
  "apiKey": "AIzaSyC3YyPJsXsX-u2EHKHcByPVj1Ru2Fn3YPo",
  "authDomain": "dominionapp-45bfa.firebaseapp.com",
  "databaseURL": "https://dominionapp-45bfa-default-rtdb.europe-west1.firebasedatabase.app",
  "projectId": "dominionapp-45bfa",
  "storageBucket": "dominionapp-45bfa.firebasestorage.app",
  "messagingSenderId": "1047436704498",
  "appId": "1:1047436704498:web:4b7f9b229b5ad7cc0fee6b"
});

const messaging = firebase.messaging();

// Data-only FCM payloads from notifyTestChat are handled here.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const notificationTitle = payload.notification?.title || data.title || 'Dominion';
  const notificationOptions = {
    body: payload.notification?.body || data.body || 'Neue Chatnachricht',
    icon: './favicon.ico',
    badge: './favicon.ico',
    data: { url: 'https://jnilats33.github.io/Dominion/' },
    tag: 'dominion-chat'
  };
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = 'https://jnilats33.github.io/Dominion/';
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientsList.find(client => client.url.startsWith(url));
    if (existing) return existing.focus();
    return clients.openWindow(url);
  })());
});
