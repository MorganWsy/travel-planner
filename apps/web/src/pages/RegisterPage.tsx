import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Form, Input } from "antd";
import { LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import { ThemeToggle } from "../components/TopBar";
import Logo from "../components/Logo";
import SliderCaptcha from "../components/SliderCaptcha";
import ScenicBackground from "../components/ScenicBackground";

/** 与后端 validate_password_strength 同一条规则：前端只提前提示，判定在后端 */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_HINT = "至少 8 位，且同时包含大写字母、小写字母和数字";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentHint, setSentHint] = useState(false);
  const [sliderKey, setSliderKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  const handleSendCode = useCallback(
    async (challengeId: string, percent: number): Promise<boolean> => {
      if (!email.includes("@")) {
        notify.warning("先填写邮箱再拖动滑块");
        return false;
      }
      setSending(true);
      try {
        await api.sendEmailCode({
          email,
          scene: "register",
          challenge_id: challengeId,
          slider_percent: percent,
        });
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

  const submit = async () => {
    if (!email || !code || !nickname || !password) {
      notify.warning("请填写全部必填项");
      return;
    }
    if (nickname.trim().length < 3) {
      notify.warning("昵称至少 3 个字");
      return;
    }
    if (!PASSWORD_RULE.test(password)) {
      notify.warning(PASSWORD_HINT);
      return;
    }
    if (password !== passwordConfirm) {
      notify.warning("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await api.register({
        email,
        code,
        password,
        password_confirm: passwordConfirm,
        display_name: nickname,
        phone: phone || undefined,
      });
      navigate("/login", { replace: true, state: { from, registered: "注册成功，请用新账号登录。" } });
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <ScenicBackground />
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-card login-card-wide">
        <div className="login-brand">
          <Logo size={56} className="login-brand-logo" />
          <span className="login-brand-name">行迹</span>
        </div>
        <p className="login-keywords">行程 · 路线 · 时间线 · 攻略</p>
        <p className="login-sub">创建账号，开始规划你的行程</p>

        <Form layout="vertical" onFinish={submit} requiredMark={false} disabled={submitting} className="auth-form-grid">
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

          <Form.Item label="安全验证" className="auth-span2">
            <SliderCaptcha key={sliderKey} onDone={handleSendCode} disabled={countdown > 0 || sending} />
            {sending ? <div className="auth-send-hint">正在发送验证码…</div> : null}
            {countdown > 0 ? <div className="auth-send-hint">{countdown}s 后可重新拖动发送验证码</div> : null}
            {sentHint && countdown === 0 && !sending ? (
              <div className="auth-send-hint">验证码已发送，5 分钟内有效，超时重新拖动滑块获取</div>
            ) : null}
          </Form.Item>

          <Form.Item label="昵称" required>
            <Input
              prefix={<UserOutlined />}
              placeholder="至少 3 个字"
              value={nickname}
              onChange={(event) => setNickname(event.target.value.trim())}
            />
          </Form.Item>
          <Form.Item label="手机号（选填）">
            <Input
              addonBefore="+86"
              placeholder="11 位手机号"
              maxLength={11}
              value={phone}
              onChange={(event) => setPhone(event.target.value.trim())}
            />
          </Form.Item>

          <Form.Item label="密码" required>
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="new-password"
              placeholder="8 位 + 大小写字母 + 数字"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="确认密码" required>
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="new-password"
              placeholder="请再次输入密码"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </Form.Item>

          <div className="auth-span2 auth-rule-hint">{PASSWORD_HINT}</div>

          <Form.Item className="auth-span2">
            <Button type="primary" htmlType="submit" block loading={submitting}>
              注册
            </Button>
          </Form.Item>
        </Form>

        <div className="login-foot">
          <span>
            已有账号？
            <Link to="/login" state={{ from }}>
              去登录
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
