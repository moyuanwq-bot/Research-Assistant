import { Button } from "@/components/ui/button";

const navItems: ReadonlyArray<{
  label: string;
  href: string;
  active?: boolean;
}> = [
  { label: "Home", href: "#home", active: true },
  { label: "Studio", href: "plate96.html" },
  { label: "About", href: "#about" },
  { label: "Journal", href: "plate96-analyze.html" },
  { label: "Reach Us", href: "#contact" },
];

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
          className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6"
          aria-label="Primary navigation"
        >
          <a
            href="#home"
            className="font-display text-3xl tracking-tight text-foreground"
            aria-label="Velorah home"
          >
            Velorah<sup className="text-xs">®</sup>
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
            className="liquid-glass h-auto rounded-full px-6 py-2.5 text-sm text-foreground transition-transform duration-300 hover:scale-[1.03] hover:bg-transparent"
          >
            <a href="plate96-analyze.html">Begin Journey</a>
          </Button>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-40 pt-32 text-center md:py-[90px]">
        <h1
          className="animate-fade-rise max-w-7xl text-5xl font-normal leading-[0.95] tracking-[-2.46px] text-foreground sm:text-7xl md:text-8xl"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          Where <em className="not-italic text-muted-foreground">dreams</em> rise
          <br className="hidden sm:block" />{" "}
          <em className="not-italic text-muted-foreground">
            through the silence.
          </em>
        </h1>

        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          We&apos;re designing tools for deep thinkers, bold creators, and quiet
          rebels. Amid the chaos, we build digital spaces for sharp focus and
          inspired work.
        </p>

        <Button
          asChild
          variant="ghost"
          className="liquid-glass animate-fade-rise-delay-2 mt-12 h-auto cursor-pointer rounded-full px-14 py-5 text-base text-foreground transition-transform duration-300 hover:scale-[1.03] hover:bg-transparent"
        >
          <a href="plate96-analyze.html">Begin Journey</a>
        </Button>
      </main>
    </div>
  );
}

export default App;
