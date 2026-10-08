'use strict';
// Same logo resolution as the website's aiLogos.ts, using the public manifest
// https://santriverse.my.id/ai-logos/lobehub-manifest.json (key → file).

const LEGACY_ALIASES = {
  moonshotai: 'moonshot', zhipuai: 'zhipu', hugginface: 'huggingface',
  iflytek: 'spark', stabilityai: 'stability', lambdalabs: 'lambda',
};
const CDN_SET = new Set(['leonardoai', 'paperspace', 'modular', 'spotify']);
const PREFIX_ALIASES = {
  glm: 'zhipu', chatglm: 'zhipu', zhipuai: 'zhipu',
  kimi: 'moonshot', moonshot: 'moonshot', moonshotai: 'moonshot',
  qwen: 'qwen', qwen2: 'qwen', qwq: 'qwen',
  ernie: 'baidu', doubao: 'bytedance', hunyuan: 'tencent',
  llama: 'meta', gpt: 'openai', o1: 'openai', o3: 'openai', o4: 'openai',
  claude: 'claude', gemini: 'gemini', grok: 'grok',
  mixtral: 'mistral', mistral: 'mistral', minimax: 'minimax',
  yi: 'yi', deepseek: 'deepseek', command: 'cohere',
};
const UPLOADED = /^(?:storage\/)?(?:flow-logos|logos)\/[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g|svg)$/;

/**
 * @param {object} o
 * @param {string} o.siteUrl     e.g. https://santriverse.my.id
 * @param {string} o.apiBaseUrl  e.g. https://api.santriverse.my.id/api
 * @param {Array<{key:string,file:string}>} o.assets manifest assets
 */
function createLogoResolver({ siteUrl, apiBaseUrl, assets = [] }) {
  const files = new Map(assets.filter((a) => a && /^[a-z0-9-]+$/i.test(a.key) && /^[a-z0-9._-]+\.svg$/i.test(a.file)).map((a) => [a.key, a.file]));
  files.set('custom', 'custom.svg');
  const site = siteUrl.replace(/\/+$/, '');
  const storage = apiBaseUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

  const byKey = (key) => {
    if (!key) return null;
    if (/^https:\/\//.test(key)) return key;
    if (UPLOADED.test(key)) return `${storage}/storage/${key.replace(/^storage\//, '')}`;
    const file = files.get(LEGACY_ALIASES[key] || key);
    if (file) return `${site}/ai-logos/${file}`;
    if (CDN_SET.has(key.toLowerCase())) return `https://cdn.simpleicons.org/${key.toLowerCase()}`;
    return null;
  };
  const keyFromPrefix = (segment) => {
    const prefix = segment.toLowerCase().split(/[-_.]/)[0];
    return PREFIX_ALIASES[prefix] || (files.has(prefix) || CDN_SET.has(prefix) ? prefix : LEGACY_ALIASES[prefix] || null);
  };
  // Website rule (first segment), then the model name after a reseller prefix ("amanai/deepseek-…").
  const keyFromModelId = (id) => {
    if (!id) return null;
    const parts = String(id).split('/');
    return keyFromPrefix(parts[0]) || (parts.length > 1 ? keyFromPrefix(parts[parts.length - 1]) : null);
  };

  return (model) => byKey(model?.logo_key) || byKey(keyFromModelId(model?.provider_model_id || model?.provider));
}

module.exports = { createLogoResolver };
