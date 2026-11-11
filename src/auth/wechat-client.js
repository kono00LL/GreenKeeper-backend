class WechatClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WechatClientError';
    this.code = code;
  }
}

function createWechatClient({ appId, appSecret, fetchImpl = fetch }) {
  return {
    async exchangeCode(code) {
      if (!appId || !appSecret) throw new WechatClientError('WECHAT_NOT_CONFIGURED');

      const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
      url.searchParams.set('appid', appId);
      url.searchParams.set('secret', appSecret);
      url.searchParams.set('code', code);
      url.searchParams.set('grant_type', 'authorization_code');

      let payload;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('WeChat request failed');
        payload = await response.json();
      } catch {
        throw new WechatClientError('WECHAT_UNAVAILABLE');
      }

      if (payload.errcode || !payload.openid) throw new WechatClientError('WECHAT_INVALID_CODE');
      return { openid: payload.openid, unionid: payload.unionid || null };
    },
  };
}

module.exports = { createWechatClient, WechatClientError };
