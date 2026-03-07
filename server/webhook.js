/** @author chaoruitao@bytedance.com by Trae */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, '..', 'webhook.config.json');
const EXAMPLE_PATH = path.join(__dirname, '..', 'webhook.config.example.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      console.warn('[Webhook] 未找到 webhook.config.json，请复制 webhook.config.example.json 并重命名为 webhook.config.json 后配置');
    }
    return null;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[Webhook] 配置文件解析失败:', e.message);
    return null;
  }
}

/**
 * 发送通用 HTTP POST 请求
 */
function httpPost(url, headers, body, timeout, label) {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      ...headers,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: timeout || 5000,
  };

  const req = (isHttps ? https : http).request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[Webhook][${label}] 发送成功, status=${res.statusCode}`);
    });
  });

  req.on('error', (err) => {
    console.error(`[Webhook][${label}] 发送失败:`, err.message);
  });
  req.on('timeout', () => {
    console.error(`[Webhook][${label}] 请求超时`);
    req.destroy();
  });

  req.write(body);
  req.end();
}

// ==================== HTTP 通用 Webhook ====================

function sendHttpWebhook(eventName, payload, httpConfig) {
  if (!httpConfig || !httpConfig.enabled) return;
  const eventConf = httpConfig.events && httpConfig.events[eventName];
  if (!eventConf || !eventConf.enabled) return;
  if (!httpConfig.url) {
    console.warn('[Webhook][HTTP] 未配置 url');
    return;
  }

  const body = JSON.stringify({
    event: eventName,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  httpPost(httpConfig.url, httpConfig.headers || {}, body, httpConfig.timeout, `HTTP:${eventName}`);
}

// ==================== NapCat QQ Webhook ====================

/**
 * 将模板字符串中的 {{key}} 替换为 payload 对应值
 */
function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : `{{${key}}}`;
  });
}

function sendNapcatQQWebhook(eventName, payload, qqConfig) {
  if (!qqConfig || !qqConfig.enabled) return;
  const eventConf = qqConfig.events && qqConfig.events[eventName];
  if (!eventConf || !eventConf.enabled) return;

  const baseUrl = qqConfig.base_url;
  const token = qqConfig.token;
  const groupId = qqConfig.group_id;

  if (!baseUrl || !groupId) {
    console.warn('[Webhook][NapCatQQ] 缺少 base_url 或 group_id 配置');
    return;
  }

  const template = qqConfig.message_template || '游戏开始: 房间{{roomId}}, 房主{{hostName}}, {{playerCount}}人';
  const text = renderTemplate(template, payload);

  const body = JSON.stringify({
    group_id: groupId,
    message: [
      {
        type: 'text',
        data: { text },
      },
    ],
  });

  const url = `${baseUrl.replace(/\/+$/, '')}/send_group_msg`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  httpPost(url, headers, body, qqConfig.timeout, `NapCatQQ:${eventName}`);
}

// ==================== 统一入口 ====================

/**
 * 发送 webhook，自动分发到所有已启用的渠道
 * @param {string} eventName 事件名称
 * @param {object} payload 数据
 */
function sendWebhook(eventName, payload) {
  const config = loadConfig();
  if (!config) return;

  sendHttpWebhook(eventName, payload, config.http);
  sendNapcatQQWebhook(eventName, payload, config.napcat_qq);
}

module.exports = { sendWebhook };
