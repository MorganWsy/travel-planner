"""邮件发送。

没有配置 SMTP 时不做实际发送，只把验证码写进服务端日志（开发模式），
接口返回 dev=true，前端据此提示「验证码在服务端日志里」。生产环境必须配好 SMTP。
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import get_settings

logger = logging.getLogger("app.mailer")

_SUBJECT = {"login": "行迹 · 登录验证码", "register": "行迹 · 注册验证码"}


def configured() -> bool:
    settings = get_settings()
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def send_code(email: str, code: str, scene: str) -> bool:
    """发送验证码。返回 True 表示真的发出去了。"""
    settings = get_settings()
    subject = _SUBJECT.get(scene, "行迹 · 验证码")
    if not configured():
        logger.warning("SMTP 未配置，验证码只写日志：%s -> %s", email, code)
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from or settings.smtp_user
    message["To"] = email
    message.set_content(f"你的验证码是 {code}，{settings.email_code_ttl_seconds // 60} 分钟内有效。如非本人操作请忽略。")

    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as client:
            client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        # 发送失败不阻断接口：验证码已落库，用户可重试；但必须留痕
        logger.error("验证码邮件发送失败：%s -> %s：%s", email, exc.__class__.__name__, exc)
        return False
    return True
