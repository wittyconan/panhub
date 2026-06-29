/**
 * 微信公众号认证 composable
 * - 前 3 次搜索免费，第 4 次起弹出认证提示
 * - 已认证用户（cookie 存在）永不弹窗
 * - 用户关闭弹窗后搜索正常进行，下次搜索再弹
 */

import { WxAuth } from "wx-auth-sdk";
import "wx-auth-sdk/dist/style.css";

const SEARCH_COUNT_KEY = "wx_auth_search_count";
const FREE_SEARCHES = 3;

export function useWxAuth() {
  const isVerified = ref(false);
  const isReady = ref(false);

  // 仅在客户端初始化
  onBeforeMount(() => {
    if (typeof window === "undefined") return;

    // 临时保存原始 showAuthModal，init() 会触发 autoCheck() 进而弹窗
    const origShow = WxAuth.showAuthModal.bind(WxAuth);
    (WxAuth as any).showAuthModal = () => {}; // 空函数阻止 autoCheck 弹窗

    // 使用 init 设置 SDK 内部状态（siteId 已可省略，SDK 自动从 referrer/域名获取）
    WxAuth.init({
      apiBase: "https://wx-auth.shenzjd.com",
      onVerified: (user: any) => {
        console.log("[wx-auth] 认证成功", user);
        isVerified.value = true;
      },
      onError: (error: any) => {
        console.error("[wx-auth] 认证失败", error);
      },
      onClose: () => {
        console.log("[wx-auth] 弹窗关闭");
      },
    });

    // 恢复原始 showAuthModal
    (WxAuth as any).showAuthModal = origShow;

    // 检查是否已有 cookie（已认证过）
    const hasCookie = document.cookie
      .split(";")
      .some((c) => c.trim().startsWith("wxauth-openid="));

    if (hasCookie) {
      // 静默验证 cookie 是否仍然有效
      fetch(
        `https://wx-auth.shenzjd.com/api/auth/check?openid=${
          document.cookie
            .split(";")
            .find((c) => c.trim().startsWith("wxauth-openid="))
            ?.split("=")[1]
            ?.trim()
        }`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.authenticated) {
            isVerified.value = true;
          }
          isReady.value = true;
        })
        .catch(() => {
          isReady.value = true;
        });
    } else {
      isReady.value = true;
    }
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

  /** 显示认证弹窗 */
  function showAuthModal() {
    // 确保 qrcode 已获取
    if (!(WxAuth as any).qrcodeUrl) {
      fetch(`https://wx-auth.shenzjd.com/api/sdk/config`)
        .then((r) => r.json())
        .then((data) => {
          if (data.qrcodeUrl) (WxAuth as any).qrcodeUrl = data.qrcodeUrl;
          if (data.wechatName) (WxAuth as any).wechatName = data.wechatName;
          WxAuth.showAuthModal();
        })
        .catch(() => {
          WxAuth.showAuthModal();
        });
    } else {
      WxAuth.showAuthModal();
    }
  }

  return {
    isVerified: computed(() => isVerified.value),
    isReady: computed(() => isReady.value),
    checkSearchAuth,
  };
}
