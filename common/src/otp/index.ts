import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../firebase/client';

export type OtpChannel = 'sms' | 'email';

/** Common interface so the delivery channel is swappable without touching callers. */
export interface OtpSender {
  readonly channel: OtpChannel;
  send(target: string, code: string): Promise<void>;
}

/**
 * Sends OTP via Fast2SMS.
 *
 * ⚠️ ACCEPTED-RISK DESIGN: the API key is read transiently from Firestore
 * (`secrets/fast2sms`) at send time and never persisted on device. It still reaches
 * this (untrusted) device, so a determined user could extract it. To secure it, move
 * this HTTP call behind a free serverless endpoint that holds the key and swap this
 * sender — the OtpSender interface stays identical.
 */
export class Fast2SmsSender implements OtpSender {
  readonly channel = 'sms' as const;

  async send(target: string, code: string): Promise<void> {
    const snap = await getDoc(doc(getDb(), 'secrets', 'fast2sms'));
    const apiKey = snap.exists() ? (snap.data() as { apiKey?: string }).apiKey : undefined;
    if (!apiKey) {
      throw new Error('Fast2SMS key not configured — an admin must set it in the seller app.');
    }
    const params = new URLSearchParams({
      route: 'otp',
      variables_values: code,
      numbers: target,
    });
    const res = await fetch(`https://www.fast2sms.com/dev/bulkV2?${params.toString()}`, {
      method: 'GET',
      headers: { authorization: apiKey }, // key in header, not URL
    });
    const body = (await res.json().catch(() => ({}))) as { return?: boolean };
    if (!res.ok || body.return === false) {
      throw new Error(`Fast2SMS send failed: ${JSON.stringify(body)}`);
    }
  }
}

/**
 * Placeholder email sender. On Spark (no server) we cannot send mail; login uses Google
 * Sign-In instead. This keeps the interface complete and swappable later (Gmail via a server).
 */
export class EmailOtpSender implements OtpSender {
  readonly channel = 'email' as const;

  async send(target: string, code: string): Promise<void> {
    console.log(`[DEV OTP][email] to=${target} code=${code}`);
  }
}

export interface OtpServiceOptions {
  sender: OtpSender;
  ttlSeconds?: number;
  maxAttempts?: number;
  codeLength?: number;
}

/**
 * Generate / deliver / verify OTP codes.
 *
 * NOTE (dev-grade): codes are stored short-lived in Firestore (`otps`) with an expiry and
 * attempt cap. For production, generation + verification should move server-side so the
 * code never lives in a client-readable document.
 */
export class OtpService {
  private readonly sender: OtpSender;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly codeLength: number;

  constructor(opts: OtpServiceOptions) {
    this.sender = opts.sender;
    this.ttlSeconds = opts.ttlSeconds ?? 300;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.codeLength = opts.codeLength ?? 6;
  }

  private generateCode(): string {
    const min = 10 ** (this.codeLength - 1);
    const span = 10 ** this.codeLength - min;
    return String(Math.floor(min + Math.random() * span));
  }

  /** Create a fresh code, store it, and deliver it via the configured sender. */
  async request(target: string): Promise<void> {
    const code = this.generateCode();
    const expiresAt = Timestamp.fromMillis(Date.now() + this.ttlSeconds * 1000);
    await addDoc(collection(getDb(), 'otps'), {
      target,
      code,
      channel: this.sender.channel,
      expiresAt,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      consumed: false,
      createdAt: serverTimestamp(),
    });
    await this.sender.send(target, code);
  }

  /** Verify a code for a target, enforcing expiry and the attempt cap. */
  async verify(target: string, code: string): Promise<boolean> {
    const q = query(
      collection(getDb(), 'otps'),
      where('target', '==', target),
      where('consumed', '==', false),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return false;
    const d = snap.docs[0];
    const data = d.data() as {
      code: string;
      expiresAt: Timestamp;
      attempts: number;
      maxAttempts: number;
    };
    if (data.expiresAt.toMillis() < Date.now()) return false;
    if (data.attempts >= data.maxAttempts) return false;
    const ok = data.code === code;
    await updateDoc(d.ref, ok ? { consumed: true } : { attempts: data.attempts + 1 });
    return ok;
  }
}
