/**
 * 统一消息出口。
 *
 * Antd 的 message/notification 只有在 App 上下文内才能继承主题与语言，
 * 所以这里用桥接组件拿到实例，其余模块只调用 notify.*，不直接 import antd 的 message。
 */

import { useEffect } from "react";
import { App } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { NotificationInstance } from "antd/es/notification/interface";

let messageApi: MessageInstance | null = null;
let notificationApi: NotificationInstance | null = null;

export function NotifyBridge() {
  const { message, notification } = App.useApp();
  useEffect(() => {
    messageApi = message;
    notificationApi = notification;
  }, [message, notification]);
  return null;
}

type Detail = { description?: string; duration?: number; key?: string };

export const notify = {
  success(content: string, detail?: Detail) {
    messageApi?.success({ content, key: detail?.key, duration: detail?.duration ?? 2.2 });
  },
  info(content: string, detail?: Detail) {
    messageApi?.info({ content, key: detail?.key });
  },
  warning(content: string, detail?: Detail) {
    messageApi?.warning({ content, key: detail?.key, duration: detail?.duration ?? 3 });
  },
  error(content: string, detail?: Detail) {
    if (detail?.description) {
      notificationApi?.error({
        message: content,
        description: detail.description,
        placement: "bottomRight",
        duration: detail.duration ?? 6,
        key: detail.key,
      });
      return;
    }
    messageApi?.error({ content, key: detail?.key, duration: detail?.duration ?? 3.5 });
  },
  notify(title: string, detail?: Detail & { type?: "success" | "info" | "warning" | "error" }) {
    notificationApi?.[detail?.type ?? "info"]({
      message: title,
      description: detail?.description,
      placement: "bottomRight",
      duration: detail?.duration ?? 5,
      key: detail?.key,
    });
  },
};
