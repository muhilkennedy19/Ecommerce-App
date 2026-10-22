# Memory Index

- [Fast2SMS key accepted risk](fast2sms-key-accepted-risk.md) — why the SMS-OTP key sits in Firestore and is pulled by the buyer app (known-insecure, user-accepted); don't re-raise unprompted
- [Push architecture](push-architecture.md) — free Cloudflare Worker + FCM v1; device tokens in pushTokens/{uid}; notifyUrl config; 10s ring channel; Worker uses claim-check (no signature verify) — accepted caveat
