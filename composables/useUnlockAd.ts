/**
 * floating-unlock 自愿支持弹窗 composable（2026-09-05 起为自愿看）
 *
 * 业务链路：
 * 1. 每次用户发起搜索，index.vue 调 maybeShowUnlockAd() 计数（localStorage 持久化）
 * 2. 每第 3 次搜索，调 <floating-unlock> WC 的 show() 自愿弹出支持弹窗
 *    （fire-and-forget，不阻塞、不影响本次搜索）
 * 3. 用户可点「下次一定 / 看完啦，支持作者」、右上角 ×、点遮罩、Esc 随时关闭
 *
 * 与旧版（强制看广告解锁）的差异：组件已静态化（@wu529778790/floating-unlock
 * >= 0.1.4）——无出码/轮询/验票/票据链路，show() 纯打开弹窗；
 * 后端无配额校验，登录（wx-auth）链路独立且保持强制，与本弹窗无关。
 *
 * 组件加载方式：layouts/default.vue 以 UMD 脚本引入 floating-unlock.wc.js，
 * 并在模板放置 <floating-unlock> 标签（本模块 querySelector 查找）。
 * 组件「不自动弹出」，show() 由业务方触发。
 */

/** floating-unlock Web Component 暴露的实例方法（对齐官方 README） */
interface FloatingUnlockElement extends HTMLElement {
  show(): void;
  close(): void;
  /** 兼容旧版：等价 show()，立即 resolve 的 Promise（不再产生票据） */
  unlock(): Promise<void>;
}

const WC_TAG = "floating-unlock";

/** 每搜索多少次自愿弹一次 */
const POPUP_EVERY = 3;
/** 搜索计数 localStorage key */
const SEARCH_COUNT_KEY = "panhub:search-count";

let resolveElPromise: Promise<FloatingUnlockElement> | null = null;

/**
 * 等待布局里的 <floating-unlock> 元素就绪（UMD 脚本注册 WC + ClientOnly 挂载）。
 * 轮询直到 querySelector 命中且 show 方法可用；超时 reject（调用方静默降级）。
 */
export function resolveFloatingUnlock(timeoutMs = 10000): Promise<FloatingUnlockElement> {
  if (resolveElPromise) return resolveElPromise;
  resolveElPromise = new Promise<FloatingUnlockElement>((resolve, reject) => {
    if (typeof window === "undefined") {
      resolveElPromise = null;
      return reject(new Error("floating-unlock 仅客户端可用"));
    }
    const startedAt = Date.now();
    const poll = () => {
      const el = document.querySelector(WC_TAG) as FloatingUnlockElement | null;
      if (el && typeof el.show === "function") return resolve(el);
      if (Date.now() - startedAt >= timeoutMs) {
        resolveElPromise = null; // 允许下次调用重试
        return reject(new Error("floating-unlock 元素加载超时"));
      }
      setTimeout(poll, 100);
    };
    poll();
  });
  return resolveElPromise;
}

/**
 * 每次搜索调用：计数 +1，每第 POPUP_EVERY 次自愿弹出支持弹窗。
 * 永不抛错、永不阻塞搜索——组件不可用时静默跳过。
 */
export function maybeShowUnlockAd(): void {
  if (typeof window === "undefined") return;

  let count = 0;
  try {
    count = parseInt(localStorage.getItem(SEARCH_COUNT_KEY) || "0", 10) || 0;
  } catch {}
  count += 1;
  try {
    localStorage.setItem(SEARCH_COUNT_KEY, String(count));
  } catch {}

  if (count % POPUP_EVERY !== 0) return;

  resolveFloatingUnlock()
    .then((el) => el.show())
    .catch((e) => {
      console.warn("[floating-unlock] 自愿支持弹窗不可用，跳过", e);
    });
}
/**
 * 兼容旧代码调用，防止报错 500: useUnlockAd is not defined
 */
export function useUnlockAd() {
  return {
    maybeShowUnlockAd,
    resolveFloatingUnlock,
    // 兼容旧版可能调用的方法名，全部做成空操作或直接 resolve
    unlock: () => Promise.resolve(),
    show: () => maybeShowUnlockAd(),
  };
}

// 默认导出兜底
export default useUnlockAd;
