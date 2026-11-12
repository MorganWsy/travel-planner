import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Form, Input } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/api";
import { errorText, setCsrfToken } from "../api/client";
import { notify } from "../lib/notify";
import { useAuthStore } from "../store/app";
import { ThemeToggle } from "../components/TopBar";
import Logo from "../components/Logo";
import SliderCaptcha from "../components/SliderCaptcha";
import ScenicBackground from "../components/ScenicBackground";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((state) => state.setUser);
  const [tab, setTab] = useState<"code" | "password">("code");
  const [registerInfo, setRegisterInfo] = useState("");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const [passwordChallenge, setPasswordChallenge] = useState<{ id: string; percent: number } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentHint, setSentHint] = useState(false);
  // 倒计时结束后 +1 让滑块重挂载归位
  const [sliderKey, setSliderKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const info = (location.state as { registered?: string } | null)?.registered;
    if (info) setRegisterInfo(info);
  }, [location.state]);

  const startCountdown = useCallback((sec: number) => {
    setCountdown(sec);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setSliderKey((key) => key + 1);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }, []);

  const login = useMutation({
    mutationFn: (payload: { email: string; password?: string; code?: string; challenge_id?: string; slider_percent?: number }) => api.login(payload),
    onSuccess: (session) => {
      setCsrfToken(session.csrf_token);
      setUser(session.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    },
    onError: (error) => notify.error(errorText(error)),
  });

  /** 滑块拖到底 → 发验证码；返回 false 时滑块回正 */
  const handleSendCode = useCallback(
    async (challengeId: string, percent: number): Promise<boolean> => {
      if (!email.includes("@")) {
        notify.warning("先填写邮箱再拖动滑块");
        return false;
      }
      setSending(true);
      try {
        await api.sendEmailCode({ email, scene: "login", challenge_id: challengeId, slider_percent: percent });
        startCountdown(60);
        setSentHint(true);
        // 面向用户只给结果，不暴露 SMTP/日志等内部实现
        notify.success("验证码已发送，请查收邮箱");
        return true;
      } catch (error) {
        notify.error(errorText(error));
        return false;
      } finally {
        setSending(false);
      }
    },
    [email, startCountdown],
  );

  const submitCode = () => {
    if (!email || !code) {
      notify.warning("请填写邮箱与验证码");
      return;
    }
    login.mutate({ email, code });
  };

  const submitPassword = () => {
    if (!email || !password) {
      notify.warning("请填写邮箱或昵称与密码");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.trim().length < 3) {
      notify.warning("账号格式不对：填邮箱，或至少 3 个字的昵称");
      return;
    }
    if (!passwordChallenge) {
      notify.warning("请先拖动滑块完成安全验证");
      return;
    }
    login.mutate({ email, password, challenge_id: passwordChallenge.id, slider_percent: passwordChallenge.percent });
  };

  /** 密码方式不用发码，滑块通过即记录凭证 */
  const handlePasswordCheck = useCallback(async (challengeId: string, percent: number) => {
    setPasswordChallenge({ id: challengeId, percent });
    return true;
  }, []);

  const from = (location.state as { from?: string } | null)?.from;

  return (
    <div className="login-page">
      <ScenicBackground />
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-card">
        <div className="login-brand">
          <Logo size={62} className="login-brand-logo" />
          <span className="login-brand-name">行迹</span>
        </div>
        <p className="login-keywords">行程 · 路线 · 时间线 · 攻略</p>
        <p className="login-sub">多日行程规划，地图、交通与版本一并管理</p>

        <div className="login-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "code"}
            className={tab === "code" ? "on" : undefined}
            onClick={() => setTab("code")}
          >
            邮箱验证码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "password"}
            className={tab === "password" ? "on" : undefined}
            onClick={() => setTab("password")}
          >
            密码登录
          </button>
        </div>

        {registerInfo ? <div className="hint-box login-hint">{registerInfo}</div> : null}

        {tab === "code" ? (
          <Form layout="vertical" onFinish={submitCode} requiredMark={false} disabled={login.isPending}>
            <Form.Item label="邮箱" required>
              <Input
                prefix={<MailOutlined />}
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value.trim())}
              />
            </Form.Item>
            <Form.Item label="邮箱验证码" required>
              <Input
                prefix={<LockOutlined />}
                placeholder="6 位验证码"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
              />
            </Form.Item>
            <Form.Item label="安全验证">
              <SliderCaptcha
                key={sliderKey}
                onDone={handleSendCode}
                disabled={countdown > 0 || sending}
                ttlSeconds={60}
                onExpire={() => setSentHint(false)}
              />
              {sending ? <div className="auth-send-hint">正在发送验证码…</div> : null}
              {countdown > 0 ? <div className="auth-send-hint">{countdown}s 后可重新拖动发送验证码</div> : null}
              {sentHint && countdown === 0 && !sending ? (
                <div className="auth-send-hint">验证码已发送，5 分钟内有效，超时重新拖动滑块获取</div>
              ) : null}
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={login.isPending} disabled={!sentHint}>
              登录
            </Button>
          </Form>
        ) : (
          <Form layout="vertical" onFinish={submitPassword} requiredMark={false} disabled={login.isPending}>
            <Form.Item label="邮箱或昵称" required>
              <Input
                prefix={<MailOutlined />}
                autoComplete="username"
                placeholder="邮箱或昵称"
                value={email}
                onChange={(event) => setEmail(event.target.value.trim())}
              />
            </Form.Item>
            <Form.Item label="密码" required>
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="安全验证">
              <SliderCaptcha
                key={`pwd-${countdown}`}
                onDone={handlePasswordCheck}
                disabled={login.isPending}
                ttlSeconds={60}
                onExpire={() => setPasswordChallenge(null)}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={login.isPending} disabled={!passwordChallenge}>
              登录
            </Button>
          </Form>
        )}

        <div className="login-foot">
          <span>
            还没有账号？
            <Link to="/register" state={{ from }}>
              立即注册
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
