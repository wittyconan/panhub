// ==UserScript==
// @name         PanHub 链接检测助手
// @name:zh      PanHub 链接检测助手
// @name:en      PanHub Link Checker
// @namespace    https://panhub.shenzjd.com
// @version      1.1.0
// @description  自动检测 PanHub 搜索结果中的失效网盘链接，标记已过期/已删除的资源，避免浪费时间点击
// @description:en  Detect expired cloud storage links in PanHub search results and mark them with a strikethrough
// @author       shenzjd
// @match        https://panhub.shenzjd.com/*
// @match        http://panhub.shenzjd.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      pan.quark.cn
// @connect      alipan.com
// @connect      alyundrive.com
// @connect      pan.baidu.com
// @connect      115.com
// @connect      *.115.com
// @connect      cloud.189.cn
// @connect      pan.xunlei.com
// @connect      drive.uc.cn
// @connect      yun.139.com
// @connect      123pan.com
// @connect      *.123pan.com
// @license      MIT
// @compatible   chrome Tampermonkey / Violentmonkey
// @compatible   firefox Greasemonkey 4+ / Tampermonkey
// @compatible   edge Tampermonkey / Violentmonkey
// @run-at       document-idle
// @icon         https://panhub.shenzjd.com/favicon.ico
// ==/UserScript==

(function () {
  "use strict";

  // ========== 配置 ==========

  /** 并发检测数 */
  const CONCURRENCY = 3;
  /** 单个链接检测超时（毫秒） */
  const TIMEOUT_MS = 8000;
  /** 同一链接缓存时间（毫秒） */
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟

  // ========== 平台检测规则 ==========
  // 每个平台只检查 <title> 标签（最可靠，不会误匹配页面正文/JS 代码）
  // 返回：true=失效, false=有效, null=无法判断

  const PLATFORM_CHECKERS = [
    {
      name: "夸克",
      match: (url) => url.includes("pan.quark.cn"),
      // 夸克失效页 title: "夸克网盘分享不存在" / "夸克网盘-分享链接已失效"
      check: (title) => /不存在|已失效|已取消|已过期/.test(title) ? true : null,
    },
    {
      name: "阿里",
      match: (url) => url.includes("alipan.com") || url.includes("aliyundrive.com"),
      // 阿里失效页 title: "页面不存在" / "阿里云盘分享链接已失效"
      check: (title) => /不存在|已失效|已过期|已取消/.test(title) ? true : null,
    },
    {
      name: "百度",
      match: (url) => url.includes("pan.baidu.com"),
      // 百度失效页 title: "百度网盘-链接错误" 或页面含 "啊哦，你来晚了"
      check: (title, body) => {
        if (/链接错误|不存在|已过期|已失效/.test(title)) return true;
        if (/啊哦，你来晚了/.test(body)) return true;
        return null;
      },
    },
    {
      name: "115",
      match: (url) => url.includes("115.com"),
      check: (title) => /已删除|不存在|已失效|已过期/.test(title) ? true : null,
    },
    {
      name: "天翼",
      match: (url) => url.includes("cloud.189.cn"),
      check: (title) => /不存在|已失效|已过期/.test(title) ? true : null,
    },
    {
      name: "迅雷",
      match: (url) => url.includes("pan.xunlei.com"),
      // 迅雷失效页 title 含 "分享" + "失效/不存在"
      check: (title) => /分享.*(失效|不存在|已过期)|不存在.*分享/.test(title) ? true : null,
    },
    {
      name: "UC",
      match: (url) => url.includes("drive.uc.cn"),
      check: (title) => /不存在|已失效|已过期/.test(title) ? true : null,
    },
    {
      name: "123",
      match: (url) => url.includes("123pan.com"),
      check: (title) => /不存在|已失效|已过期/.test(title) ? true : null,
    },
  ];

  // 通用兜底（仅对 HTTP 404/410 等明确错误码生效，不扫描正文）
  const HTTP_DEAD_CODES = [404, 410, 510];

  // ========== 工具函数 ==========

  /** 简易并发控制器 */
  function createPool(limit) {
    let active = 0;
    const queue = [];
    function next() {
      if (queue.length === 0 || active >= limit) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => {
        active--;
        next();
      });
    }
    return function (fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    };
  }

  /** 从 HTML 中提取 <title> 内容 */
  function extractTitle(body) {
    const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    return m ? m[1].trim() : "";
  }

  /**
   * 按平台检测链接是否失效
   * @returns {boolean|null} true=失效, false=有效, null=无法判断
   */
  function isExpiredResponse(url, status, body) {
    // HTTP 明确错误码 → 失效
    if (HTTP_DEAD_CODES.includes(status)) return true;
    // HTTP 非 200 且非重定向 → 可能失效
    if (status >= 400 && status < 500) return true;
    // 没有响应体 → 无法判断
    if (!body || body.length < 50) return null;

    const title = extractTitle(body);

    // 按平台匹配检测器
    for (const checker of PLATFORM_CHECKERS) {
      if (checker.match(url)) {
        return checker.check(title, body);
      }
    }

    // 未知平台：只检查 HTTP 状态码，不扫描正文（避免误判）
    return null;
  }

  /** 用 GM_xmlhttpRequest 检测单个链接 */
  function checkLink(url) {
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          timeout: TIMEOUT_MS,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          },
          onload: function (response) {
            const body = response.responseText || "";
            const expired = isExpiredResponse(url, response.status, body);
            resolve({
              alive: expired === false,
              expired: expired === true,
              status: response.status,
            });
          },
          onerror: function () {
            // 网络错误（DNS 失败、连接拒绝）→ 可能失效
            resolve({ alive: false, expired: true, status: 0 });
          },
          ontimeout: function () {
            // 超时 → 无法判断，不标记
            resolve({ alive: null, expired: null, status: 0 });
          },
        });
      } catch {
        resolve({ alive: null, expired: null, status: 0 });
      }
    });
  }

  // ========== 缓存 ==========

  const resultCache = new Map(); // url → { expired, timestamp }

  function getCached(url) {
    const entry = resultCache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      resultCache.delete(url);
      return null;
    }
    return entry;
  }

  function setCache(url, expired) {
    resultCache.set(url, { expired, timestamp: Date.now() });
  }

  // ========== UI 操作 ==========

  const CHECKED_ATTR = "data-link-checked";

  /** 标记链接为失效（仅视觉提醒，不阻止点击，用户可自行验证） */
  function markExpired(linkEl) {
    linkEl.style.textDecoration = "line-through";
    linkEl.style.opacity = "0.5";
    linkEl.setAttribute("title", "⚠️ 该链接可能已失效（系统自动检测），点击可自行验证");

    // 添加失效标签
    const badge = document.createElement("span");
    badge.textContent = "可能失效";
    badge.style.cssText =
      "display:inline-block;margin-left:6px;padding:1px 6px;font-size:11px;font-weight:600;color:#fff;background:#ef4444;border-radius:4px;vertical-align:middle;line-height:1.4;";
    linkEl.appendChild(badge);
  }

  /** 标记链接为有效 */
  function markAlive(linkEl) {
    // 可选：给有效链接加一个小绿点
    // linkEl.style.borderLeft = "3px solid #10b981";
  }

  // ========== 核心逻辑 ==========

  async function processLinks() {
    const linkEls = document.querySelectorAll(
      ".resource-link:not([" + CHECKED_ATTR + "])"
    );
    if (linkEls.length === 0) return;

    // 标记为已处理（防止重复检测）
    linkEls.forEach((el) => el.setAttribute(CHECKED_ATTR, "true"));

    const pool = createPool(CONCURRENCY);
    const tasks = Array.from(linkEls).map((linkEl) =>
      pool(async () => {
        const url = linkEl.getAttribute("href");
        if (!url || !url.startsWith("http")) return;

        // 检查缓存
        const cached = getCached(url);
        if (cached) {
          if (cached.expired) markExpired(linkEl);
          else markAlive(linkEl);
          return;
        }

        // 检测链接
        const result = await checkLink(url);

        if (result.expired === true) {
          setCache(url, true);
          markExpired(linkEl);
        } else if (result.alive === true) {
          setCache(url, false);
          markAlive(linkEl);
        }
        // result.expired === null (超时) → 不标记，不缓存
      })
    );

    await Promise.allSettled(tasks);
  }

  // ========== 监听 ==========

  /** 用 MutationObserver 监听新结果加载 */
  const observer = new MutationObserver(function (mutations) {
    let hasNewLinks = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (
          node.classList?.contains("resource-link") ||
          node.querySelector?.(".resource-link")
        ) {
          hasNewLinks = true;
          break;
        }
      }
      if (hasNewLinks) break;
    }
    if (hasNewLinks) {
      // 延迟一点等 DOM 稳定
      setTimeout(processLinks, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 页面加载完成后也执行一次
  if (document.readyState === "complete") {
    setTimeout(processLinks, 1000);
  } else {
    window.addEventListener("load", function () {
      setTimeout(processLinks, 1000);
    });
  }

  // 暴露给 PanHub 页面（供未来集成使用）
  if (typeof unsafeWindow !== "undefined") {
    unsafeWindow.__panhub_linkCheckerReady = true;
    unsafeWindow.__panhub_checkLink = checkLink;
  }

  console.log("[PanHub Link Checker] ✅ 链接检测助手已加载");
})();
