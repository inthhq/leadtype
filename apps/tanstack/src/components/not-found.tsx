import { Link } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-start justify-center gap-4 px-4 py-7 sm:px-6">
        <p className="font-medium text-accent-strong text-sm">404</p>
        <h1 className="font-heading font-medium text-3xl text-foreground tracking-tight sm:text-4xl">
          Page not found
        </h1>
        <p className="max-w-xl text-muted-foreground text-sm leading-7">
          We couldn't find that page. Check the URL, or head back to the
          reference app.
        </p>
        <Link
          className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
          to="/docs"
        >
          Back to docs
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
