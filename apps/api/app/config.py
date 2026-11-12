"""运行配置。

原则：所有可变配置来自环境变量或 .env；不在代码中写死密钥，也不读取其他项目的凭据。
缺失供应商 Key 属于正常状态（capabilities 会报告 configured=false），不影响自有数据闭环。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "apps" / "api" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_version: str = "0.2.0"
    public_base_url: str = "http://localhost:5177"

    database_url: str = "postgresql+psycopg://travel:CHANGE_ME@127.0.0.1:5432/travel_planner"
    storage_root: Path = DEFAULT_DATA_DIR
    provider_policy_path: Path = PROJECT_ROOT / "config" / "provider_policy.json"

    session_secret: str = "dev-only-insecure-session-secret-change-me"
    session_ttl_days: int = 14
    session_idle_days: int = 7
    cookie_secure: bool = False
    cookie_name: str = "tp_session"

    registration_mode: str = "open"  # open | invite

    # 邮箱验证码与滑块验证
    captcha_threshold: int = 95  # 滑块需拖到 95% 以上
    captcha_ttl_seconds: int = 60
    email_code_ttl_seconds: int = 300
    email_code_resend_seconds: int = 60
    # 未配置 SMTP 时验证码只写日志，接口返回 dev=true 方便本地联调
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    invite_codes: str = ""  # 逗号分隔，仅 registration_mode=invite 时使用

    amap_key: str = ""
    tianditu_key: str = ""
    tianditu_browser_key: str = ""
    provider_timeout_seconds: float = 10.0
    provider_qps: float = 1.0

    # 无路网数据时的显式估算参数（结果须标注为估算，不冒充真实路况）
    estimate_driving_kmh: float = 28.0
    estimate_walking_kmh: float = 4.5
    estimate_detour_factor: float = 1.35
    estimate_speed_kmh: float = 28.0

    limits_max_days: int = 30
    limits_max_stops_per_day: int = 30
    limits_max_candidates: int = 100
    limits_max_place_name: int = 120
    limits_max_notes: int = 10000

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def invite_code_set(self) -> set[str]:
        return {item.strip() for item in self.invite_codes.split(",") if item.strip()}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    return settings
