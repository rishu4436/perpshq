// Default verification must never accidentally turn a missing mock into a live service read.
if (process.env.LIVE_TESTS !== '1') {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return Promise.reject(new Error('Live network disabled in local tests: ' + url.hostname));
    return original(input, init);
  };
}
