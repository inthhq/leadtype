const footerLinks = [
  {
    href: "https://github.com/inthhq/docs",
    label: "GitHub",
  },
  {
    href: "https://www.npmjs.com/package/leadtype",
    label: "npm",
  },
  {
    href: "/llms.txt",
    label: "llms.txt",
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-border border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>leadtype reference app</p>
        <nav
          aria-label="Project links"
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          {footerLinks.map((link) => (
            <a
              className="font-medium text-muted-foreground transition-colors hover:text-foreground"
              href={link.href}
              key={link.href}
              rel={link.href.startsWith("http") ? "noopener" : undefined}
              target={link.href.startsWith("http") ? "_blank" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
