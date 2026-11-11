const { randomUUID } = require('node:crypto');
const { WechatClientError } = require('./wechat-client');

class WechatAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WechatAuthError';
    this.status = status;
    this.code = code;
  }
}

function createWechatAuthService({ db, wechatClient, createUserId = randomUUID }) {
  async function login({ code }) {
    if (typeof code !== 'string' || code.length < 1 || code.length > 512) {
      throw new WechatAuthError(400, 'VALIDATION_ERROR', '微信授权 code 无效');
    }

    let identity;
    try {
      identity = await wechatClient.exchangeCode(code);
    } catch (error) {
      if (error instanceof WechatClientError && error.code === 'WECHAT_NOT_CONFIGURED') {
        throw new WechatAuthError(503, 'WECHAT_NOT_CONFIGURED', '微信登录服务尚未配置');
      }
      if (error instanceof WechatClientError && error.code === 'WECHAT_UNAVAILABLE') {
        throw new WechatAuthError(502, 'WECHAT_UNAVAILABLE', '微信服务暂时不可用');
      }
      throw new WechatAuthError(401, 'WECHAT_CODE_INVALID', '微信授权已失效，请重新登录');
    }

    if (!identity?.openid || typeof identity.openid !== 'string') {
      throw new WechatAuthError(502, 'WECHAT_RESPONSE_INVALID', '微信返回的身份信息无效');
    }

    return db.transaction(() => {
      let user = db.prepare(`SELECT users.id, users.email, users.user_name, users.avatar_url,
        users.gender, users.created_at, users.status, users.last_login_at
        FROM users JOIN wechat_accounts ON wechat_accounts.user_id = users.id
        WHERE wechat_accounts.openid = ?`).get(identity.openid);
      const now = new Date().toISOString();

      if (!user) {
        const id = createUserId();
        db.prepare(`INSERT INTO users (id, email, password_hash, user_name, gender, status, created_at, last_login_at)
          VALUES (?, NULL, NULL, '微信用户', 'private', 1, ?, ?)`).run(id, now, now);
        db.prepare('INSERT INTO wechat_accounts (user_id, openid, unionid, created_at) VALUES (?, ?, ?, ?)')
          .run(id, identity.openid, identity.unionid || null, now);
        user = db.prepare(`SELECT id, email, user_name, avatar_url, gender, created_at, status, last_login_at
          FROM users WHERE id = ?`).get(id);
      } else {
        if (user.status === 0) throw new WechatAuthError(403, 'ACCOUNT_DISABLED', '账户当前不可用');
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
        db.prepare('UPDATE wechat_accounts SET unionid = COALESCE(?, unionid) WHERE user_id = ?')
          .run(identity.unionid || null, user.id);
        user = db.prepare(`SELECT id, email, user_name, avatar_url, gender, created_at, status, last_login_at
          FROM users WHERE id = ?`).get(user.id);
      }
      return user;
    })();
  }

  return { login };
}

module.exports = { createWechatAuthService, WechatAuthError };
