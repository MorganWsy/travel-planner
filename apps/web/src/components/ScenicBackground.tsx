import { useEffect, useState } from "react";

/**
 * 登录/注册页的全屏风景背景：多层图片叠放，靠 opacity 过渡切换。
 *
 * 图片在 public/img/auth-bg/（江西武宁一带的实景，1920×1080 JPEG）。
 * 首图立刻加载，其余在首帧之后才挂载，避免首屏抢带宽；
 * 标签页切到后台时暂停计时，回来再接着轮。
 */
const SLIDES = [
  { src: "/img/auth-bg/wuning-ChengShiFengMao.jpg", caption: "武宁 · 城市风貌" },
  { src: "/img/auth-bg/wuning-JiuLingShan-1.jpg", caption: "武宁 · 九岭山" },
  { src: "/img/auth-bg/wuning-JiuLingShan-2.jpg", caption: "武宁 · 九岭山" },
  { src: "/img/auth-bg/wuning-JiuLingShan-3.jpg", caption: "武宁 · 九岭山" },
  { src: "/img/auth-bg/wuning-XiHaiWan.jpg", caption: "武宁 · 西海湾" },
  { src: "/img/auth-bg/wuning-QingJiangXiang-1.jpg", caption: "武宁 · 清江乡" },
  { src: "/img/auth-bg/wuning-TaiPingShan.jpg", caption: "武宁 · 太平山雪景" },
  { src: "/img/auth-bg/wuning-LiuShan-1.jpg", caption: "武宁 · 柳山" },
];

export default function ScenicBackground({ interval = 7000 }: { interval?: number }) {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(1);

  // 首帧之后把剩下的图挂上，浏览器自行预载
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(SLIDES.length), 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") setIndex((value) => (value + 1) % SLIDES.length);
    };
    timer = window.setInterval(tick, interval);
    return () => window.clearInterval(timer);
  }, [interval]);

  return (
    <div className="scenic-bg" aria-hidden>
      {SLIDES.slice(0, mounted).map((slide, position) => (
        <div
          key={slide.src}
          className={`scenic-bg-slide${position === index ? " active" : ""}`}
          style={{ backgroundImage: `url(${slide.src})` }}
        />
      ))}
      <div className="scenic-bg-dim" />
      <div className="scenic-bg-caption">
        <span className="scenic-bg-caption-bar" />
        {SLIDES[index].caption}
      </div>
    </div>
  );
}
