const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');

const CODE_TTL_MS = 5 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 60 * 1000;
const EMAIL_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const MAX_ATTEMPTS = 5;

class EmailAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalidCode = () => new EmailAuthError(401, 'INVALID_EMAIL_CODE', '验证码无效或已过期');

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EmailAuthError(400, 'VALIDATION_ERROR', '请输入有效的邮箱地址');
  }
  return email;
}

function createEmailAuthService({ db, emailSender, emailCodeSecret, createUserId = randomUUID }) {
  const codeDigest = (email, purpose, code) => createHmac('sha256', emailCodeSecret)
    .update(`${email}:${purpose}:${code}`)
    .digest();
  const ipDigest = (ip) => createHmac('sha256', emailCodeSecret).update(ip || 'unknown').digest('hex');

  async function requestCode({ email: rawEmail, purpose, ip }) {
    if (!emailCodeSecret) throw new EmailAuthError(503, 'EMAIL_AUTH_NOT_CONFIGURED', '邮箱验证码服务尚未配置');
    const email = normalizeEmail(rawEmail);
    if (!['login', 'password_reset'].includes(purpose)) {
      throw new EmailAuthError(400, 'VALIDATION_ERROR', 'purpose 必须是 login 或 password_reset');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const hashedIp = ipDigest(ip);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();

    const reservation = db.transaction(() => {
      db.prepare('DELETE FROM email_code_requests WHERE created_at < ?').run(dayAgo);
      db.prepare('DELETE FROM email_verification_codes WHERE expires_at < ?').run(dayAgo);
      const lastEmailRequest = db.prepare('SELECT created_at FROM email_code_requests WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
      if (lastEmailRequest && now.getTime() - new Date(lastEmailRequest.created_at).getTime() < EMAIL_COOLDOWN_MS) {
        throw new EmailAuthError(429, 'EMAIL_CODE_RATE_LIMITED', '请稍后再获取验证码');
      }
      const emailCount = db.prepare('SELECT COUNT(*) AS count FROM email_code_requests WHERE email = ? AND created_at >= ?').get(email, hourAgo).count;
      const ipCount = db.prepare('SELECT COUNT(*) AS count FROM email_code_requests WHERE ip_hash = ? AND created_at >= ?').get(hashedIp, hourAgo).count;
      if (emailCount >= EMAIL_HOURLY_LIMIT || ipCount >= IP_HOURLY_LIMIT) {
        throw new EmailAuthError(429, 'EMAIL_CODE_RATE_LIMITED', '验证码请求过于频繁，请稍后重试');
      }

      db.prepare('UPDATE email_verification_codes SET used_at = COALESCE(used_at, ?) WHERE email = ? AND purpose = ? AND used_at IS NULL').run(nowIso, email, purpose);
      db.prepare(`INSERT INTO email_verification_codes
        (id, email, purpose, code_hash, created_at, expires_at, delivery_status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
        .run(id, email, purpose, codeDigest(email, purpose, code), nowIso, new Date(now.getTime() + CODE_TTL_MS).toISOString());
      db.prepare('INSERT INTO email_code_requests (id, email, ip_hash, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), email, hashedIp, nowIso);
      return { id, code };
    })();

    try {
      await emailSender({
        to: email,
        purpose,
        variables: { code: reservation.code, expire_minutes: '5' },
      });
      db.prepare("UPDATE email_verification_codes SET delivery_status = 'sent', sent_at = ? WHERE id = ? AND delivery_status = 'pending'").run(new Date().toISOString(), reservation.id);
      return { success: true };
    } catch (error) {
      db.prepare("UPDATE email_verification_codes SET delivery_status = 'failed' WHERE id = ? AND delivery_status = 'pending'").run(reservation.id);
      if (error?.code === 'SES_NOT_CONFIGURED') {
        throw new EmailAuthError(503, 'EMAIL_AUTH_NOT_CONFIGURED', '邮箱验证码服务尚未配置');
      }
      throw new EmailAuthError(502, 'EMAIL_DELIVERY_FAILED', '验证码邮件发送失败，请稍后重试');
    }
  }

  function consumeCode(email, purpose, code, onValid) {
    const now = new Date();
    const result = db.transaction(() => {
      const record = db.prepare(`SELECT * FROM email_verification_codes
        WHERE email = ? AND purpose = ? AND used_at IS NULL AND delivery_status = 'sent'
        ORDER BY created_at DESC LIMIT 1`).get(email, purpose);
      if (!record || record.attempts >= MAX_ATTEMPTS || new Date(record.expires_at) <= now) return { error: invalidCode() };

      const supplied = codeDigest(email, purpose, String(code ?? ''));
      if (supplied.length !== record.code_hash.length || !timingSafeEqual(supplied, record.code_hash)) {
        db.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
        return { error: invalidCode() };
      }

      const value = onValid(record, now);
      db.prepare('UPDATE email_verification_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now.toISOString(), record.id);
      return { value };
    })();
    if (result.error) throw result.error;
    return result.value;
  }

  function verifyLogin({ email: rawEmail, code, userName }) {
    if (!emailCodeSecret) throw new EmailAuthError(503, 'EMAIL_AUTH_NOT_CONFIGURED', '邮箱验证码服务尚未配置');
    const email = normalizeEmail(rawEmail);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalidCode();
    if (userName !== undefined && (typeof userName !== 'string' || userName.trim().length > 10)) {
      throw new EmailAuthError(400, 'VALIDATION_ERROR', 'user_name 最多 10 个字符');
    }
    const name = userName === undefined ? '匿名用户' : userName.trim();
    return consumeCode(email, 'login', code, (_record, now) => {
      let user = db.prepare('SELECT id, email, user_name, avatar_url, gender, created_at, status, last_login_at FROM users WHERE email = ?').get(email);
      if (!user) {
        const id = createUserId();
        db.prepare(`INSERT INTO users (id, email, password_hash, user_name, gender, status, created_at, last_login_at)
          VALUES (?, ?, NULL, ?, 'private', 1, ?, ?)`)
          .run(id, email, name || '匿名用户', now.toISOString(), now.toISOString());
        user = db.prepare('SELECT id, email, user_name, avatar_url, gender, created_at, status, last_login_at FROM users WHERE id = ?').get(id);
      } else {
        if (user.status === 0) throw new EmailAuthError(403, 'ACCOUNT_DISABLED', '账户当前不可用');
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), user.id);
        user = db.prepare('SELECT id, email, user_name, avatar_url, gender, created_at, status, last_login_at FROM users WHERE id = ?').get(user.id);
      }
      return user;
    });
  }

  async function resetPassword({ email: rawEmail, code, newPassword }) {
    if (!emailCodeSecret) throw new EmailAuthError(503, 'EMAIL_AUTH_NOT_CONFIGURED', '邮箱验证码服务尚未配置');
    const email = normalizeEmail(rawEmail);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalidCode();
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) {
      throw new EmailAuthError(400, 'VALIDATION_ERROR', '密码长度必须为 8 至 72 个字符');
    }
    const codeId = checkCode(email, 'password_reset', code);
    const newHash = await bcrypt.hash(newPassword, 12);
    const result = db.transaction(() => {
      const now = new Date();
      const user = db.prepare('SELECT id, password_hash, status FROM users WHERE email = ?').get(email);
      if (!user || !user.password_hash || user.status === 0) throw invalidCode();
      const consumed = db.prepare(`UPDATE email_verification_codes SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND delivery_status = 'sent' AND attempts < ? AND expires_at > ?`)
        .run(now.toISOString(), codeId, MAX_ATTEMPTS, now.toISOString());
      if (consumed.changes !== 1) throw invalidCode();
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
      db.prepare('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND revoked_at IS NULL').run(now.toISOString(), user.id);
      return { success: true };
    })();
    return result;
  }

  function checkCode(email, purpose, code) {
    const now = new Date();
    const record = db.prepare(`SELECT * FROM email_verification_codes
      WHERE email = ? AND purpose = ? AND used_at IS NULL AND delivery_status = 'sent'
      ORDER BY created_at DESC LIMIT 1`).get(email, purpose);
    if (!record || record.attempts >= MAX_ATTEMPTS || new Date(record.expires_at) <= now) throw invalidCode();
    const supplied = codeDigest(email, purpose, code);
    if (supplied.length !== record.code_hash.length || !timingSafeEqual(supplied, record.code_hash)) {
      db.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ?').run(record.id, MAX_ATTEMPTS);
      throw invalidCode();
    }
    return record.id;
  }

  return { requestCode, verifyLogin, resetPassword };
}

module.exports = { createEmailAuthService, EmailAuthError, normalizeEmail };
