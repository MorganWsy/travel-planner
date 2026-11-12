"""探测本机访问外网时的出口 IP。

为什么要专门做这个：天地图「服务器端」Key 按请求来源 IP 校验白名单，
而这条 IP 是服务器出口 IP，既不是 127.0.0.1，也可能随宽带重拨或校园网换出口而变。

探测源必须用**国内**站点。实测过：系统里配了 HTTP_PROXY 时，国外站点走代理、
国内站点直连，两者出口 IP 不同（222.204.1.9 与 220.175.48.235）。
天地图是国内服务，走的是直连那条，用国外源探测会把用户引到错误的地址上。

探测失败不算错误：拿不到就返回空值，页面不显示这一行，不影响其它设置。
"""

from __future__ import annotations

import re
import time

import httpx

# 只用国内可达的源；返回文本里带中文字段，靠正则抠 IP
_SOURCES = (
    "https://myip.ipip.net",
    "https://www.taobao.com/help/getip.php",
)
_IPV4 = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
_TTL_SECONDS = 600.0

_cache: dict[str, float | str | None] = {"at": 0.0, "ip": None}


def _looks_like_ipv4(text: str) -> bool:
    if not _IPV4.fullmatch(text):
        return False
    return all(0 <= int(part) <= 255 for part in text.split("."))


def _extract(body: str) -> str | None:
    """从响应里抠出第一个合法 IPv4。国内接口常夹中文，不能整串比对。"""
    for candidate in _IPV4.findall(body):
        if _looks_like_ipv4(candidate):
            return candidate
    return None


def detect(*, force: bool = False) -> str | None:
    """返回出口 IP；十分钟内复用上次结果，避免每次进设置页都打外网。"""
    cached_at = float(_cache["at"] or 0.0)
    cached_ip = _cache["ip"]
    if not force and isinstance(cached_ip, str) and time.monotonic() - cached_at < _TTL_SECONDS:
        return cached_ip

    for url in _SOURCES:
        try:
            response = httpx.get(url, timeout=4.0, follow_redirects=True)
        except httpx.HTTPError:
            continue
        if response.status_code != 200:
            continue
        found = _extract(response.text)
        if found:
            _cache["at"] = time.monotonic()
            _cache["ip"] = found
            return found

    # 探测失败不缓存“失败”，否则网络恢复后十分钟内都显示为空。
    _cache["at"] = 0.0
    _cache["ip"] = None
    return None
