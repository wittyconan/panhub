/**
 * 微信公众号认证 composable
 * - 前 3 次搜索免费，第 4 次起弹出认证提示
 * - 已认证用户（cookie 存在）永不弹窗
 * - 用户关闭弹窗后搜索正常进行，下次搜索再弹
 *
 * 临时禁用：图片访问问题
 */

// import { WxAuth } from "wx-auth-sdk";
// import "wx-auth-sdk/dist/style.css";

const SEARCH_COUNT_KEY = "wx_auth_search_count";
const FREE_SEARCHES = 3;

export function useWxAuth() {
  const isVerified = ref(false);
  const isReady = ref(false);

  // 仅在客户端初始化
  onBeforeMount(() => {
    if (typeof window === "undefined") return;

    // 临时禁用：图片访问问题
    // 直接标记就绪，跳过所有认证逻辑
    isReady.value = true;
  });

  /** 搜索计数 +1，返回是否需要弹出认证 */
  function checkSearchAuth(): boolean {
    if (typeof window === "undefined") return false;
    if (isVerified.value) return false;

    const count = parseInt(localStorage.getItem(SEARCH_COUNT_KEY) || "0", 10) + 1;
    localStorage.setItem(SEARCH_COUNT_KEY, String(count));

    if (count > FREE_SEARCHES) {
      // 弹出认证弹窗（不阻塞，用户可关闭后继续搜索）
      showAuthModal();
      return true;
    }
    return false;
  }

  /** 显示认证弹窗 - 临时禁用 */
  function showAuthModal() {
    // 临时禁用：图片访问问题
    // console.log("[wx-auth] 弹窗功能已禁用");
  }

  return {
    isVerified: computed(() => isVerified.value),
    isReady: computed(() => isReady.value),
    checkSearchAuth,
  };
}
