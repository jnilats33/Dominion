// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase Konfiguration für den Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyD-DominionAppPlaceholderKey", // Entspricht deiner Firebase-Konfiguration
  projectId: "dominionapp-45bfa",
  databaseURL: "https://dominionapp-45bfa-default-rtdb.europe-west1.firebasedatabase.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef"
});

const messaging = firebase.messaging();

// Hintergrund-Nachrichten empfangen und als System-Benachrichtigung anzeigen
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Hintergrundnachricht empfangen:', payload);
  
  const notificationTitle = payload.notification?.title || 'Dominion App';
  const notificationOptions = {
    body: payload.notification?.body || 'Neue Aktivität im System.',
    icon: './favicon.ico',
    badge: './favicon.ico',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});