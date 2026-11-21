# Dominion production release — preparation only

**Status:** NOT DEPLOYED. Branch `release/chatv2-push-preparation`; production `main` untouched.

## Invariants
- Keep RTDB room `rooms/D+W Connection` and all non-chat records.
- Keep browser state key `dominion_app_state_v2` and its legacy keys.
- Chat history is disposable by owner approval; do not delete old `chat` automatically.
- New chat writes only to `rooms/D+W Connection/chatV2/<messageId>`.
- Never initialize an absent production room with default state.
- Never deploy the functions or merge without verifying live RTDB rules, App Check, and existing data shape.

## Files staged
- `index.html`: test UI/chat v2 changes adapted to production room and browser storage; writes blocked until remote production room is loaded.
- `firebase-messaging-sw.js`: real Firebase config, production notification link.
- `functions/index.js`: **new** functions `registerProductionPushDevice` and `notifyProductionChatV2`, preserving deployed test functions.
- `firebase.json` / `functions/package.json`: source files only; no deployment.

## Required pre-release checks
1. Owner confirms two local backups: in-app JSON export and full RTDB JSON export (confirmed 2026-11-21).
2. Review **current live RTDB security rules**: authenticated roles, permissions to read production room and write `chatV2`, denial of client writes to `pushDevices`; verify no broad public access.
3. Confirm App Check authorized domains, Firebase Auth authorized domains and production role claims.
4. Verify data schema, images and non-chat paths against production export **locally** (do not upload private backups to chat).
5. Review all changes against production `main` for regressions, test in isolated environment.
6. Deploy functions by exact name only, after rule review: `firebase deploy --only functions:registerProductionPushDevice,functions:notifyProductionChatV2 --project dominionapp-45bfa`. **Do not run until explicitly approved.**
7. Confirm registrations and push in both directions; deploy/merge front-end only after backend verification and explicit approval.
8. Keep rollback commit `0133a461b7c92d854c49f18dfbf11e35186d0ad4`; rollback code does not reverse any data writes.

## Important
Both Test and Production use the same Firebase project. The new production function names and room-specific trigger paths must remain separate from test functions. No automatic chat deletion is performed.
