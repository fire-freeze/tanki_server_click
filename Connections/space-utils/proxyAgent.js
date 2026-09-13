import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * Returns the correct proxy agent based on the proxyUrl protocol.
 * - socks5:// / socks4:// → SocksProxyAgent (works with any port, incl. 9092)
 * - http:// / https://    → HttpsProxyAgent
 * - "" / null             → null (no proxy)
 */
export function getProxyAgent(proxyUrl) {
  if (!proxyUrl || proxyUrl === "") return null;
  const lower = proxyUrl.toLowerCase();
  if (lower.startsWith("socks5://") || lower.startsWith("socks4://") || lower.startsWith("socks://")) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}
