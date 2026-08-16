import { ArrowRight, ChartNoAxesCombined, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";

const navItems = [
  { label: "首页", href: "#home", active: true },
  { label: "96 孔板标记", href: "plate96.html", active: false },
  { label: "Excel 数据分析", href: "plate96-analyze.html", active: false },
] as const;

function App() {
  return (
    <div
      id="home"
      className="relative isolate flex min-h-svh flex-col overflow-hidden bg-background text-foreground"
    >
      <video
        className="absolute inset-0 z-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4"
          type="video/mp4"
        />
      </video>

      <header className="relative z-10 w-full">
        <nav
          className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6"
          aria-label="主导航"
        >
          <a
            href="#home"
            className="font-display text-3xl tracking-tight text-foreground"
            aria-label="LabTools 首页"
          >
            LabTools<sup className="ml-1 font-sans text-[10px] font-medium tracking-widest">LAB</sup>
          </a>

          <div className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={
                  item.active
                    ? "text-sm text-foreground transition-colors"
                    : "text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </div>

          <Button
            asChild
            variant="ghost"
            className="liquid-glass h-auto rounded-full px-5 py-2.5 text-sm text-foreground transition-transform duration-300 hover:scale-[1.03] hover:bg-transparent sm:px-6"
          >
            <a href="#tools">选择工具</a>
          </Button>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-14 text-center sm:px-6 sm:pb-16 sm:pt-20 md:py-[72px]">
        <p className="animate-fade-rise mb-5 text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground sm:text-sm">
          Biological research utilities
        </p>

        <h1
          className="animate-fade-rise max-w-6xl text-5xl font-normal leading-[0.95] tracking-[-2px] text-foreground sm:text-7xl md:text-8xl md:tracking-[-2.46px]"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          让实验记录
          <br />
          <em className="not-italic text-muted-foreground">简单、清晰。</em>
        </h1>

        <p className="animate-fade-rise-delay mt-7 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mt-8 sm:text-lg">
          为日常生物实验设计的轻量在线工具。标记 96 孔板、分析多时间点吸光度数据，
          所有数据只在你的浏览器本地处理，不上传服务器。
        </p>

        <div
          id="tools"
          className="animate-fade-rise-delay-2 mt-9 grid w-full max-w-3xl gap-3 sm:mt-11 sm:grid-cols-2 sm:gap-4"
        >
          <a
            href="plate96.html"
            className="group flex min-h-28 items-center gap-4 rounded-2xl bg-foreground px-5 py-5 text-left text-primary-foreground shadow-2xl transition-transform duration-300 hover:scale-[1.02] sm:min-h-32 sm:px-6"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/10">
              <FlaskConical className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium uppercase tracking-[0.16em] text-black/50">
                Plate planner
              </span>
              <span className="mt-1 block text-lg font-medium">96 孔板标记</span>
              <span className="mt-1 block text-xs text-black/55">规划样品、标准品、空白与对照</span>
            </span>
            <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </a>

          <a
            href="plate96-analyze.html"
            className="liquid-glass group flex min-h-28 items-center gap-4 rounded-2xl bg-[#002e42]/70 px-5 py-5 text-left text-foreground shadow-2xl transition-transform duration-300 hover:scale-[1.02] sm:min-h-32 sm:px-6"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10">
              <ChartNoAxesCombined className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Data analysis
              </span>
              <span className="mt-1 block text-lg font-medium">Excel 数据分析</span>
              <span className="mt-1 block text-xs text-muted-foreground">生成热图、变化曲线与分析工作簿</span>
            </span>
            <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </a>
        </div>

        <p className="animate-fade-rise-delay-2 mt-5 text-xs text-white/45">
          免费 · 开源 · 无需安装
        </p>
      </main>
    </div>
  );
}

export default App;
