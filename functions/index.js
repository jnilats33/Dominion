'use strict';

// Dominion production push functions. Deploy only after validating production RTDB rules.
const { onValueCreated } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('firebase-functions/logger');

initializeApp();

const ROOM = 'D+W Connection';
const REGION = 'europe-west1';
const ROLES = new Set(['Master', 'Daisy']);

function verifiedRole(request) {
  // Only Firebase Auth custom claims issued by a trusted administrator count.
  const role = request.auth?.token?.dominionTestRole;
  if (!ROLES.has(role)) throw new HttpsError('permission-denied', 'Verified Firebase role required.');
  return role;
}

exports.registerProductionPushDevice = onCall({
  region: REGION,
  maxInstances: 2,
  enforceAppCheck: true,
}, async (request) => {
  const role = verifiedRole(request);
  const { token, deviceId } = request.data || {};
  if (typeof token !== 'string' || token.length < 50 || token.length > 4096 ||
      typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(deviceId)) {
    throw new HttpsError('invalid-argument', 'Invalid device registration.');
  }
  // Token paths are server-owned and must be denied to RTDB clients.
  await getDatabase().ref(`pushDevices/${ROOM}/${role}/${deviceId}`).set({
    token,
    updatedAt: Date.now(),
  });
  return { registered: true };
});

// Dedicated production function name leaves existing test triggers untouched.
// Deploy only notifyProductionChatV2 after checking the Firebase project, region and rules.
exports.notifyProductionChatV2 = onValueCreated({
  ref: `/rooms/${ROOM}/chatV2/{messageId}`,
  instance: 'dominionapp-45bfa-default-rtdb',
  region: REGION,
  maxInstances: 2,
  retry: false,
}, async (event) => {
  const message = event.data.val();
  if (!message || !ROLES.has(message.sender) ||
      typeof message.id !== 'string' || message.id !== event.params.messageId) {
    logger.warn('production_push_skipped_invalid_message', {
      hasMessage: !!message,
      senderRoleValid: ROLES.has(message?.sender),
      messageIdValid: typeof message?.id === 'string' && message.id === event.params.messageId,
    });
    return;
  }

  const recipient = message.sender === 'Master' ? 'Daisy' : 'Master';
  logger.info('production_push_message_received', { sender: message.sender, recipient });

  const devicesSnapshot = await getDatabase().ref(`pushDevices/${ROOM}/${recipient}`).get();
  const devices = devicesSnapshot.val() || {};
  const entries = Object.entries(devices).filter(([, v]) => typeof v?.token === 'string');
  logger.info('production_push_recipient_devices', { recipient, registeredDevices: entries.length });
  if (!entries.length) return;

  const selected = entries.slice(0, 500); // FCM multicast limit.
  const tokens = selected.map(([, v]) => v.token);
  try {
    const response = await getMessaging().sendEachForMulticast({
      tokens,
      data: {
        title: 'Dominion',
        body: message.audio ? 'Neue Sprachnachricht' : message.image ? 'Neue Bildnachricht' : 'Neue Chatnachricht',
        url: 'https://jnilats33.github.io/Dominion/',
      },
      webpush: { fcmOptions: { link: 'https://jnilats33.github.io/Dominion/' } },
    });
    const invalid = [];
    const errorCounts = {};
    response.responses.forEach((result, i) => {
      if (!result.success) {
        const code = result.error?.code || 'unknown';
        errorCounts[code] = (errorCounts[code] || 0) + 1;
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
          invalid.push(selected[i][0]);
        }
      }
    });
    logger.info('production_push_fcm_result', {
      recipient,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errorCounts,
    });
    await Promise.all(invalid.map(id => getDatabase().ref(`pushDevices/${ROOM}/${recipient}/${id}`).remove()));
  } catch (error) {
    logger.error('production_push_send_exception', { recipient, code: error.code || 'unknown' });
    throw error;
  }
});
