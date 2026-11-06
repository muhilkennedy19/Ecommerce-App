# Memory Index

- [Fast2SMS key accepted risk](fast2sms-key-accepted-risk.md) — why the SMS-OTP key sits in Firestore and is pulled by the buyer app (known-insecure, user-accepted); don't re-raise unprompted
- [Push architecture](push-architecture.md) — free Cloudflare Worker + FCM v1; device tokens in pushTokens/{uid}; notifyUrl config; 10s ring channel; Worker uses claim-check (no signature verify) — accepted caveat
- [Observability](observability.md) — shared logger + error boundary + New Relic Log API over plain HTTPS (no native agent); `newRelicKey` in app.local.json; minLevel=warn means a healthy app sends nothing
- [Firestore query budget](firestore-query-budget.md) — no unbounded onSnapshot on growing collections; what is bounded today; paginated lists need a single-doc listener for their detail screen
