export function Footer() {
  return (
    <footer className="px-5 pt-8 pb-12 border-t border-border relative z-[1]">
      <div className="font-extrabold text-[16px] tracking-tight text-text">
        Club<span className="text-accent">Keeper</span>
      </div>
      <nav className="flex flex-wrap gap-3.5 mt-3.5 mb-4">
        {['About', 'Contact', 'Terms', 'Privacy'].map((link) => (
          <a key={link} href="#" className="text-text-faint text-[13px]">
            {link}
          </a>
        ))}
      </nav>
      <div className="font-mono text-[12px] text-text-faint tracking-[.04em]">
        Made in Pune, India ❤️
      </div>
      <div className="font-mono text-[11.5px] text-text-faint mt-1.5">
        © 2026 ClubKeeper. All rights reserved.
      </div>
    </footer>
  )
}
