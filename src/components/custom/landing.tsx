"use client";

import React, { forwardRef, useEffect, useRef, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const INJECTED_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800;900&display=swap');

  * { box-sizing: border-box; }

  .gsap-reveal { visibility: hidden; }

  .film-grain {
    position: absolute; inset: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 50; opacity: 0.04; mix-blend-mode: multiply;
    background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch"/></filter><rect width="100%25" height="100%25" filter="url(%23n)"/></svg>');
  }

  .bg-grid-warm {
    background-size: 48px 48px;
    background-image:
      radial-gradient(circle, var(--border) 1px, transparent 1px);
    opacity: 0.45;
  }

  .font-streak { font-family: 'JetBrains Mono', 'Courier New', monospace; }

  .text-hero-main {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--foreground);
    line-height: 0.92;
  }

  .text-hero-accent {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--primary);
    line-height: 0.92;
  }

  .text-hero-sub {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--muted-foreground);
    font-size: clamp(10px, 1.1vw, 14px);
  }

  .main-card {
    background: var(--card);
    border: 5px solid var(--foreground);
    box-shadow: 16px 16px 0 var(--primary);
    position: relative;
  }

  .phone-shell {
    background: var(--muted);
    border: 3px solid var(--foreground);
    box-shadow: 8px 8px 0 var(--primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .phone-header {
    background: var(--background);
    border-bottom: 2px solid var(--border);
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .phone-header-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--muted-foreground);
  }

  .streak-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 900;
    color: var(--primary);
    letter-spacing: 0.1em;
    border: 2px solid var(--primary);
    padding: 2px 8px;
  }

  .phone-body {
    flex: 1;
    overflow: hidden;
    position: relative;
    background: var(--background);
  }

  .scene-idle {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    padding: 16px 14px;
    gap: 10px;
  }

  .habit-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 2px solid var(--border);
    background: var(--muted);
    will-change: transform, opacity;
    transform: translateZ(0);
  }

  .habit-row.overdue { border-color: var(--primary); }

  .habit-check {
    width: 18px; height: 18px;
    border: 2px solid var(--border);
    flex-shrink: 0;
    background: transparent;
  }
  .habit-check.done {
    background: var(--primary);
    border-color: var(--primary);
  }

  .habit-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(10px, 1.4vw, 13px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--foreground);
    flex: 1;
  }

  .habit-streak-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 900;
    color: var(--primary);
    letter-spacing: 0.05em;
  }

  .scene-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--muted-foreground);
    margin-bottom: 4px;
  }

  /* ────────────────────────────────
     PUSH NOTIFICATION
  ─────────────────────────────────*/
  .scene-notif {
    position: absolute;
    top: 8px; left: 8px; right: 8px;
    height: 104px;
    z-index: 20;
    overflow: hidden;
    background: var(--card);
    border: 2px solid var(--foreground);
    box-shadow: 4px 4px 0 var(--primary);
  }

  .notif-banner-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px 8px;
  }

  .notif-app-icon {
    width: 30px; height: 30px;
    background: var(--primary);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    flex-shrink: 0;
  }

  .notif-text-col { flex: 1; min-width: 0; }

  .notif-app-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--primary);
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .notif-time {
    color: var(--muted-foreground);
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  .notif-preview-text {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(8px, 1.05vw, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--foreground);
    line-height: 1.5;
    /* two-line clamp */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .notif-actions-row {
    display: flex;
    border-top: 1px solid var(--border);
    margin-top: 2px;
  }

  .notif-action {
    flex: 1;
    padding: 8px 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    text-align: center;
    cursor: default;
  }

  .notif-action.dismiss {
    color: var(--muted-foreground);
    border-right: 1px solid var(--border);
  }

  .notif-action.open {
    color: var(--primary);
  }

  /* expanded state inner content */
  .notif-expanded-content {
    padding: 12px;
    border-top: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .notif-expanded-msg {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(9px, 1.1vw, 11px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--foreground);
    line-height: 1.6;
    padding: 10px;
    background: var(--muted);
    border: 1px solid var(--border);
  }

  .notif-expanded-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--primary);
    margin-bottom: 4px;
    display: block;
  }

  .notif-open-btn {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    padding: 10px 16px;
    background: var(--primary);
    color: #fff;
    border: 2px solid var(--foreground);
    text-align: center;
    margin-top: 2px;
  }

  .scene-chat {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    padding: 14px;
    gap: 10px;
    overflow: hidden;
  }

  .chat-bubble {
    max-width: 88%;
    padding: 10px 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(9px, 1.25vw, 12px);
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.5;
    text-transform: uppercase;
  }

  .chat-bubble.ai {
    align-self: flex-start;
    background: var(--muted);
    border: 2px solid var(--primary);
    color: var(--foreground);
  }

  .chat-bubble.user {
    align-self: flex-end;
    background: var(--primary);
    border: 2px solid var(--primary);
    color: #fff;
  }

  .chat-input-bar {
    margin-top: auto;
    border: 2px solid var(--border);
    background: var(--muted);
    padding: 9px 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chat-cursor {
    width: 8px; height: 14px;
    background: var(--primary);
    animation: blink 1s step-end infinite;
  }

  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  .scene-report {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    padding: 14px;
    gap: 8px;
  }

  .report-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(8px, 1.1vw, 11px);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--primary);
    border-bottom: 2px solid var(--primary);
    padding-bottom: 6px;
    margin-bottom: 4px;
  }

  .report-stat {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(8px, 1.1vw, 11px);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .report-stat .label { color: var(--muted-foreground); font-weight: 700; }
  .report-stat .val   { color: var(--foreground); font-weight: 900; }
  .report-stat .val.bad { color: var(--primary); }

  .report-roast {
    margin-top: 6px;
    padding: 10px;
    border: 2px solid var(--primary);
    background: var(--muted);
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(8px, 1.1vw, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    line-height: 1.6;
    color: var(--foreground);
  }

  .report-roast .ai-tag {
    color: var(--primary);
    display: block;
    margin-bottom: 4px;
    font-size: 9px;
    letter-spacing: 0.2em;
  }

  .collapse-void {
    position: absolute; inset: 0;
    background: var(--primary);
    opacity: 0;
    z-index: 10;
  }

  .streak-btn {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    padding: 16px 36px;
    background: var(--primary);
    color: #fff;
    border: 3px solid var(--foreground);
    box-shadow: 5px 5px 0 var(--foreground);
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.1s;
    white-space: nowrap;
  }
  .streak-btn:hover  { transform: translate(2px,2px); box-shadow: 3px 3px 0 var(--foreground); }
  .streak-btn:active { transform: translate(5px,5px); box-shadow: 0 0 0 var(--foreground); }

  .streak-btn-ghost {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    padding: 16px 36px;
    background: transparent;
    color: var(--foreground);
    border: 3px solid var(--foreground);
    box-shadow: 5px 5px 0 var(--primary);
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.1s, background 0.1s;
    white-space: nowrap;
  }
  .streak-btn-ghost:hover  {
    transform: translate(2px,2px);
    box-shadow: 3px 3px 0 var(--primary);
    background: var(--foreground);
    color: var(--background);
  }
  .streak-btn-ghost:active { transform: translate(5px,5px); box-shadow: 0 0 0 var(--primary); }

  .demo-overlay {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
    z-index: 9999;
    padding: 24px;
    backdrop-filter: blur(3px);
  }

  .demo-modal {
    background: var(--card);
    border: 4px solid var(--foreground);
    box-shadow: 12px 12px 0 var(--primary);
    padding: 16px;
    width: min(960px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .demo-close {
    align-self: flex-end;
    background: transparent;
    color: var(--foreground);
    border: 2px solid var(--border);
    padding: 6px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }
  .demo-close:hover { border-color: var(--primary); color: var(--primary); }

  .demo-frame {
    width: 100%; aspect-ratio: 16/9;
    border: 2px solid var(--border);
    background: var(--muted); overflow: hidden;
  }
  .demo-frame iframe { width: 100%; height: 100%; border: none; }

  .ticker-wrap {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 32px;
    background: var(--primary);
    border-top: 3px solid var(--foreground);
    overflow: hidden;
    display: flex;
    align-items: center;
    z-index: 30;
  }

  .ticker-track {
    display: flex;
    animation: ticker 24s linear infinite;
    white-space: nowrap;
  }

  @keyframes ticker {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  .ticker-item {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: #fff;
    padding: 0 28px;
  }

  .ticker-sep {
    color: rgba(255,255,255,0.45);
    font-weight: 900;
    font-size: 11px;
    padding: 0 4px;
    font-family: 'JetBrains Mono', monospace;
  }

  .counter-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 36px;
    background: var(--background);
    border-bottom: 3px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    z-index: 25;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--muted-foreground);
  }

  .counter-bar .live {
    color: var(--primary);
    font-weight: 900;
    font-size: 10px;
    letter-spacing: 0.2em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .live-dot {
    width: 6px; height: 6px;
    background: var(--primary);
    border-radius: 50%;
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%,100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.3; transform: scale(0.7); }
  }

  @media (max-width: 1023px) {
    .card-side-text { display: none !important; }
  }
`;

let _landingStylesInjected = false;
function injectLandingStyles() {
  if (typeof window === "undefined" || _landingStylesInjected) return;
  if (document.querySelector("[data-streak-landing-styles]")) {
    _landingStylesInjected = true;
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-streak-landing-styles", "1");
  style.textContent = INJECTED_STYLES;
  document.head.appendChild(style);
  _landingStylesInjected = true;
}

const TICKER_ITEMS = [
  "DON'T BREAK THE STREAK",
  "AI COACH IS WATCHING",
  "MISS ONE DAY. HEAR ABOUT IT.",
  "HABIT TRACKER, NOT A JOURNAL",
  "ZERO EXCUSES",
  "CONSISTENCY OR CONSEQUENCES",
  "WEEKLY ROAST EVERY SUNDAY",
  "YOUR FUTURE SELF WILL THANK YOU",
];

function TickerBar() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="ticker-wrap" aria-hidden="true">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <React.Fragment key={i}>
            <span className="ticker-item">{item}</span>
            <span className="ticker-sep">{"///"}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

const PhoneMockup = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div
      ref={ref}
      className="phone-shell"
      style={{
        width: "100%",
        maxWidth: 360,
        height: "100%",
        maxHeight: 560,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div className="phone-header">
        <span className="phone-header-label">Streak</span>
        <span className="streak-badge">🔥 Day 42</span>
      </div>

      {/* Body */}
      <div className="phone-body">
        {/* ── SCENE A: Habit List ── */}
        <div className="scene-idle scene-a">
          <span className="scene-label">Today&apos;s Habits</span>

          <div className="habit-row">
            <div className="habit-check done" />
            <span className="habit-name">Morning Run</span>
            <span className="habit-streak-num">🔥 14</span>
          </div>

          <div className="habit-row overdue">
            <div className="habit-check" />
            <span className="habit-name">Read 30 Min</span>
            <span className="habit-streak-num">⚠ 0</span>
          </div>

          <div className="habit-row overdue">
            <div className="habit-check" />
            <span className="habit-name">Cold Shower</span>
            <span className="habit-streak-num">⚠ 0</span>
          </div>

          <div className="habit-row">
            <div className="habit-check done" />
            <span className="habit-name">No Alcohol</span>
            <span className="habit-streak-num">🔥 42</span>
          </div>
        </div>

        {/* ── PUSH NOTIFICATION (slides in over habit list) ── */}
        <div className="scene-notif" aria-hidden="true">
          {/* Collapsed banner */}
          <div className="notif-banner-row">
            <div className="notif-app-icon">🔥</div>
            <div className="notif-text-col">
              <div className="notif-app-label">
                Streak Coach
                <span className="notif-time">now</span>
              </div>
              <div className="notif-preview-text">
                It&apos;s 6:35 PM — &quot;Read 30 Min&quot; still unchecked.
                Don&apos;t make me ask again.
              </div>
            </div>
          </div>
          <div className="notif-actions-row">
            <div className="notif-action dismiss">Dismiss</div>
            <div className="notif-action open">Open Chat →</div>
          </div>

          {/* Expanded content (visible only when notification grows) */}
          <div className="notif-expanded-content">
            <div className="notif-expanded-msg">
              <span className="notif-expanded-tag">AI Coach · 6:35 PM</span>
              Two habits still unchecked. You have until midnight. I&apos;m not
              letting you off easy this time — open the chat or the streak dies
              tonight.
            </div>
            <div className="notif-open-btn">Open Coach Chat →</div>
          </div>
        </div>

        {/* ── Flash void ── */}
        <div className="collapse-void" aria-hidden="true" />

        {/* ── SCENE B: AI Roast Chat ── */}
        <div className="scene-chat scene-b" style={{ opacity: 0 }}>
          <div className="chat-bubble ai">
            It&apos;s 6:35 PM. You still haven&apos;t checked in for &quot;Read
            30 Min.&quot; This is embarrassing, honestly.
          </div>
          <div className="chat-bubble user">i was busy bro</div>
          <div className="chat-bubble ai">
            &quot;Busy.&quot; Day 0 streak incoming if you don&apos;t log right
            now. Clock is ticking. No pressure — oh wait, yes there is.
          </div>
          <div className="chat-input-bar">
            <span style={{ flex: 1 }}>Type your check-in...</span>
            <div className="chat-cursor" />
          </div>
        </div>

        {/* ── SCENE C: Weekly Roast Report ── */}
        <div className="scene-report scene-c" style={{ opacity: 0 }}>
          <div className="report-title">Weekly Roast — Week 17</div>

          <div className="report-stat">
            <span className="label">Target Days</span>
            <span className="val">21</span>
          </div>
          <div className="report-stat">
            <span className="label">Completed</span>
            <span className="val">13</span>
          </div>
          <div className="report-stat">
            <span className="label">Missed</span>
            <span className="val bad">8</span>
          </div>
          <div className="report-stat">
            <span className="label">Completion</span>
            <span className="val bad">62%</span>
          </div>

          <div className="report-roast">
            <span className="ai-tag">AI COACH SAYS:</span>
            62% is participation trophy territory. You skipped cold showers 5
            times. Your past self is cringing. Do better this week or week
            18&apos;s roast goes public.
          </div>
        </div>
      </div>
    </div>
  );
});
PhoneMockup.displayName = "PhoneMockup";

export interface StreakHeroProps extends React.HTMLAttributes<HTMLDivElement> {
  brandName?: string;
  tagline1?: string;
  tagline2?: string;
  cardHeading?: string;
  cardDescription?: React.ReactNode;
  ctaHeading?: string;
  ctaDescription?: string;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
  demoVideoUrl?: string;
}

export function StreakHero({
  brandName = "STREAK",
  tagline1 = "Build habits.",
  tagline2 = "Or get roasted.",
  cardHeading = "The AI Coach That Won't Let You Off The Hook",
  cardDescription = (
    <>
      <span className="font-bold">Streak</span> tracks your habits, fires
      proactive reminders throughout the day, and — when you fail — delivers a
      brutally honest weekly roast. Because nice doesn&apos;t build consistency.
    </>
  ),
  ctaHeading = "No More Excuses.",
  ctaDescription = "Set your habits. Let the AI hound you. Break the chain and hear about it. Every. Single. Time.",
  primaryCtaLabel = "Watch Demo",
  secondaryCtaLabel = "Start My Streak",
  demoVideoUrl = "https://player.mux.com/tB5fsbVtlsOBZIpfCG8l0101cTlIReZpWX4drMSVRO8Lo?metadata-video-title=Rick+Astley+Never+Gonna+Give+You+Up+240p&video-title=Rick+Astley+Never+Gonna+Give+You+Up+240p",
  className,
  ...props
}: StreakHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCardRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [isMobileAuthFlow, setIsMobileAuthFlow] = useState(false);

  useEffect(() => {
    injectLandingStyles();
    ScrollTrigger.killAll();

    const isMobile = window.innerWidth < 768;
    const isTouch = ScrollTrigger.isTouch === 1;

    if (isMobile && isTouch) {
      ScrollTrigger.config({ ignoreMobileResize: true });
    }

    const ctx = gsap.context(() => {
      /* ── Initial states ── */
      gsap.set(".hero-tagline-1", { autoAlpha: 0, y: 90, scale: 0.72 });
      gsap.set(".hero-tagline-2", {
        autoAlpha: 1,
        clipPath: "inset(0 100% 0 0)",
      });
      gsap.set(".main-card", { y: window.innerHeight + 200, autoAlpha: 1 });
      gsap.set([".card-side-text", ".mockup-wrap"], { autoAlpha: 0 });
      gsap.set(".cta-wrapper", { autoAlpha: 0, scale: 0.75 });
      gsap.set(".scene-b", { autoAlpha: 0 });
      gsap.set(".scene-c", { autoAlpha: 0 });
      gsap.set(".collapse-void", { autoAlpha: 0 });
      gsap.set(".scene-a .scene-label", { autoAlpha: 0, y: 10 });
      gsap.set(".scene-a .habit-row", {
        autoAlpha: 0,
        y: 46,
        rotateX: -8,
        transformOrigin: "50% 100%",
      });
      gsap.set(".scene-a .habit-check", { autoAlpha: 0, scale: 0.85 });
      gsap.set(".scene-a .habit-streak-num", { autoAlpha: 0, x: 8 });
      gsap.set(".chat-bubble", { autoAlpha: 0, y: 14 });
      gsap.set(".report-stat", { autoAlpha: 0, x: -12 });
      gsap.set(".report-roast", { autoAlpha: 0, y: 10 });

      // ── NEW: Notification initial state ──
      // Starts hidden and above the phone body (slides in from top)
      gsap.set(".scene-notif", {
        autoAlpha: 0,
        y: -90,
        height: 104,
        top: 8,
        left: 8,
        right: 8,
      });

      /* ── Intro (no scroll) ── */
      const intro = gsap.timeline({ delay: 0.25 });
      intro
        .to(".hero-tagline-1", {
          duration: 1.3,
          autoAlpha: 1,
          y: 0,
          scale: 1,
          ease: "power3.out",
        })
        .to(
          ".hero-tagline-2",
          { duration: 1.1, clipPath: "inset(0 0% 0 0)", ease: "power3.inOut" },
          "-=0.65",
        );

      /* ── Main scroll timeline ── */
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "+=8500", // slightly longer to give notification sequence breathing room
          pin: true,
          scrub: 1.2,
          anticipatePin: 1,
          pinSpacing: true,
        },
      });

      tl
        /* Fade hero text */
        .to(
          [".hero-text-wrapper", ".bg-grid-warm"],
          { scale: 1.12, autoAlpha: 0, ease: "power2.in", duration: 1.5 },
          1,
        )
        /* Card rises */
        .to(".main-card", { y: 0, ease: "power3.inOut", duration: 1.5 }, 0)
        .to(".main-card", {
          width: "100%",
          height: "100%",
          ease: "power2.inOut",
          duration: 1.2,
        })
        /* Mockup + panels */
        .fromTo(
          ".mockup-wrap",
          { y: 180, autoAlpha: 0, scale: 0.75 },
          { y: 0, autoAlpha: 1, scale: 1, ease: "power3.out", duration: 2 },
          "-=0.5",
        )
        .fromTo(
          ".card-left-panel",
          { x: -50, autoAlpha: 0 },
          { x: 0, autoAlpha: 1, ease: "power2.out", duration: 1.1 },
          "-=1.1",
        )
        .fromTo(
          ".card-right-panel",
          { x: 50, autoAlpha: 0 },
          { x: 0, autoAlpha: 1, ease: "power2.out", duration: 1.1 },
          "<",
        )
        /* Scene A: habits appear */
        .to(
          ".scene-a .scene-label",
          { autoAlpha: 1, y: 0, ease: "power2.out", duration: 0.28 },
          "-=0.65",
        )
        .to(
          ".scene-a .habit-row",
          {
            autoAlpha: 1,
            y: 0,
            rotateX: 0,
            ease: "power3.out",
            duration: isMobile ? 0.4 : 0.48,
            stagger: { each: isMobile ? 0.08 : 0.1, from: "start" },
          },
          "-=0.2",
        )
        .to(
          ".scene-a .habit-check",
          {
            autoAlpha: 1,
            scale: 1,
            ease: "back.out(2)",
            duration: 0.22,
            stagger: isMobile ? 0.06 : 0.08,
          },
          "<+0.08",
        )
        .to(
          ".scene-a .habit-streak-num",
          {
            autoAlpha: 1,
            x: 0,
            ease: "power2.out",
            duration: 0.2,
            stagger: isMobile ? 0.06 : 0.08,
          },
          "<+0.02",
        )
        .to({}, { duration: 0.45 }) // brief hold after habits settle

        // ── NEW BLOCK: Push Notification ──────────────────────────────
        // 1. Notification slides down from above into the phone body
        .to(".scene-notif", {
          autoAlpha: 1,
          y: 0,
          ease: "back.out(1.3)",
          duration: 0.5,
        })
        .to({}, { duration: 1.1 }) // user "reads" the notification

        // 2. Notification expands to fill the phone body (user taps it)
        .to(".scene-notif", {
          height: 600, // large enough to fill; phone-body clips overflow
          top: 0,
          left: 0,
          right: 0,
          ease: "power2.inOut",
          duration: 0.55,
        })
        .to({}, { duration: 0.35 }) // brief hold on expanded notification
        // ─────────────────────────────────────────────────────────────

        /* ── Scene A + Notif → B (flash) ── */
        .to(".collapse-void", { autoAlpha: 1, duration: 0.12 })
        .to([".scene-a", ".scene-notif"], { autoAlpha: 0, duration: 0.01 })
        .to(".scene-b", { autoAlpha: 1, duration: 0.01 })
        .to(".collapse-void", { autoAlpha: 0, duration: 0.12 })
        .to(".chat-bubble", {
          autoAlpha: 1,
          y: 0,
          ease: "power3.out",
          duration: 0.35,
          stagger: 0.18,
        })
        .to({}, { duration: 0.7 })

        /* ── Scene B → C (flash) ── */
        .to(".collapse-void", { autoAlpha: 1, duration: 0.12 })
        .to(".scene-b", { autoAlpha: 0, duration: 0.01 })
        .to(".scene-c", { autoAlpha: 1, duration: 0.01 })
        .to(".collapse-void", { autoAlpha: 0, duration: 0.12 })
        .to(".report-stat", {
          autoAlpha: 1,
          x: 0,
          ease: "power2.out",
          duration: 0.22,
          stagger: 0.1,
        })
        .to(".report-roast", {
          autoAlpha: 1,
          y: 0,
          ease: "power2.out",
          duration: 0.3,
        })
        .to({}, { duration: 1 })

        /* ── Outro → CTA ── */
        .to(".hero-text-wrapper", { autoAlpha: 0, duration: 0.01 })
        .to(".cta-wrapper", { autoAlpha: 1, duration: 0.01 })
        .to([".mockup-wrap", ".card-left-panel", ".card-right-panel"], {
          scale: 0.87,
          y: -28,
          autoAlpha: 0,
          ease: "power2.in",
          duration: 0.9,
          stagger: 0.03,
        })
        .to(
          ".main-card",
          {
            width: isMobile ? "95vw" : "90vw",
            height: isMobile ? "95vh" : "88vh",
            ease: "power2.inOut",
            duration: 1.4,
          },
          "pullback",
        )
        .to(
          ".cta-wrapper",
          { scale: 1, ease: "power2.out", duration: 1.4 },
          "pullback",
        )
        .to(".main-card", {
          y: -window.innerHeight - 300,
          ease: "power2.in",
          duration: 1.2,
        });
    }, containerRef);

    return () => {
      ctx.revert();
      ScrollTrigger.killAll();

      if (isMobile && isTouch) {
        ScrollTrigger.config({ ignoreMobileResize: false });
      }
    };
  }, []);

  useEffect(() => {
    const update = () => setIsMobileAuthFlow(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!isDemoOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDemoOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [isDemoOpen]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-screen w-full items-center justify-center bg-background text-foreground antialiased",
        className,
      )}
      {...props}
    >
      <div className="film-grain" aria-hidden="true" />
      <div
        className="bg-grid-warm pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      />

      {/* ── HERO TAGLINES ── */}
      <div className="hero-text-wrapper absolute z-10 flex w-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-2">
          <span
            className="hero-tagline-1 gsap-reveal text-hero-main"
            style={{ fontSize: "clamp(3.2rem,9vw,9.5rem)", display: "block" }}
          >
            {tagline1}
          </span>
        </div>
        <div>
          <span
            className="hero-tagline-2 text-hero-accent"
            style={{ fontSize: "clamp(3.2rem,9vw,9.5rem)", display: "block" }}
          >
            {tagline2}
          </span>
        </div>
        <p className="text-hero-sub mt-8">
          Brutalist habit tracking · AI roast coach · Real streaks, real
          consequences
        </p>
      </div>

      {/* ── CTA ── */}
      <div className="cta-wrapper gsap-reveal pointer-events-auto absolute z-10 flex w-full flex-col items-center justify-center px-6 text-center">
        <div
          className="font-streak mb-3 text-xs font-bold uppercase tracking-widest"
          style={{ color: "var(--primary)", letterSpacing: "0.3em" }}
        >
          {"// You've seen what it does."}
        </div>
        <h2
          className="text-hero-main mb-6"
          style={{ fontSize: "clamp(2.5rem,7vw,7rem)" }}
        >
          {ctaHeading}
        </h2>
        <p
          className="font-streak mx-auto mb-12 max-w-xl text-sm uppercase leading-relaxed tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          {ctaDescription}
        </p>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <button
            className="streak-btn"
            type="button"
            onClick={() => setIsDemoOpen(true)}
          >
            {primaryCtaLabel}
          </button>
          <SignInButton
            {...(isMobileAuthFlow ? {} : { mode: "modal" as const })}
            forceRedirectUrl="/dashboard"
            fallbackRedirectUrl="/dashboard"
            signUpForceRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/dashboard"
          >
            <button className="streak-btn-ghost" type="button">
              {secondaryCtaLabel}
            </button>
          </SignInButton>
        </div>
        <p
          className="font-streak mt-6 text-xs uppercase tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          Free · 3 habits · No credit card · Pro unlocks everything
        </p>
      </div>

      {/* ── DEMO MODAL ── */}
      {isDemoOpen && (
        <div
          className="demo-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Demo video"
          onClick={() => setIsDemoOpen(false)}
        >
          <div className="demo-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="demo-close"
              type="button"
              onClick={() => setIsDemoOpen(false)}
            >
              [ESC] Close
            </button>
            <div className="demo-frame">
              <iframe
                src={demoVideoUrl}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
                title="Streak Demo"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── FOREGROUND: SLAB CARD ── */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div
          ref={mainCardRef}
          className="main-card gsap-reveal pointer-events-auto relative flex h-[95vh] w-[95vw] items-center justify-center overflow-hidden md:h-[88vh] md:w-[90vw]"
          style={{ paddingBottom: 35 }}
        >
          {/* Counter bar */}
          <div className="counter-bar">
            <span>Streak — Habit Tracker</span>
            <span className="live">
              <span className="live-dot" />
              Live
            </span>
            <span>v1.0</span>
          </div>

          {/* 3-col grid */}
          <div
            className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-start gap-4 px-4 pb-4 pt-12 lg:grid lg:items-center lg:justify-center lg:gap-8 lg:px-12 lg:py-0"
            style={{ gridTemplateColumns: "1fr 1.3fr 1fr" }}
          >
            {/* LEFT */}
            <div className="card-left-panel card-side-text gsap-reveal z-20 order-3 hidden w-full flex-col justify-center lg:order-1 lg:flex">
              <p
                className="font-streak mb-3 text-xs font-bold uppercase tracking-widest"
                style={{ color: "var(--primary)" }}
              >
                {"// What it is"}
              </p>
              <h3
                className="font-streak mb-4 font-black uppercase leading-tight"
                style={{
                  fontSize: "clamp(1.3rem,2.2vw,2rem)",
                  letterSpacing: "-0.01em",
                  color: "var(--foreground)",
                }}
              >
                {cardHeading}
              </h3>
              <p
                className="font-streak text-xs uppercase leading-relaxed tracking-wide"
                style={{ color: "var(--muted-foreground)", maxWidth: 280 }}
              >
                {cardDescription}
              </p>

              <div className="mt-6 flex flex-col gap-2">
                {[
                  "Proactive AI reminders 4pm · 6pm · 6:35pm",
                  "Conversational check-ins via chat",
                  "Weekly AI roast report every Sunday",
                  "Real-time streak tracking",
                ].map((f) => (
                  <div
                    key={f}
                    className="font-streak flex items-start gap-2 text-xs uppercase tracking-wide"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <span style={{ color: "var(--primary)", flexShrink: 0 }}>
                      ▸
                    </span>
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {/* CENTER: Phone */}
            <div className="mockup-wrap relative z-10 order-2 flex h-[68vh] min-h-[440px] w-full items-center justify-center sm:h-[520px] lg:order-2 lg:h-[560px]">
              <PhoneMockup ref={mockupRef} />
            </div>

            {/* RIGHT */}
            <div className="card-right-panel card-side-text gsap-reveal z-20 order-1 hidden w-full flex-col items-end justify-center lg:order-3 lg:flex">
              <h2
                className="font-streak font-black uppercase"
                style={{
                  fontSize: "clamp(3rem,6vw,6.5rem)",
                  letterSpacing: "-0.03em",
                  lineHeight: 0.9,
                  textAlign: "right",
                  color: "var(--foreground)",
                }}
              >
                {brandName}
              </h2>
              <span
                className="font-streak mb-8 mt-1 block text-right text-xs font-bold uppercase tracking-widest"
                style={{ color: "var(--primary)" }}
              >
                {"// Habit OS"}
              </span>

              <div
                className="flex flex-col gap-3"
                style={{ width: "100%", maxWidth: 220 }}
              >
                {[
                  { n: "3", label: "Free Habits" },
                  { n: "∞", label: "Pro Habits" },
                  { n: "20/day", label: "Free AI Messages" },
                  { n: "∞", label: "Pro AI Messages" },
                ].map(({ n, label }) => (
                  <div
                    key={label}
                    className="font-streak flex items-center justify-between border-b"
                    style={{
                      borderColor: "var(--border)",
                      paddingBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "clamp(0.65rem,1vw,0.75rem)",
                        color: "var(--muted-foreground)",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        color: "var(--foreground)",
                        fontWeight: 900,
                        fontSize: "clamp(0.9rem,1.4vw,1.1rem)",
                      }}
                    >
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <TickerBar />
        </div>
      </div>
    </div>
  );
}
