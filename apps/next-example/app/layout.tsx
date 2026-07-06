import type { ReactNode } from "react";
import { LeadtypeWebMcp } from "@/components/leadtype-webmcp";
import "./styles.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LeadtypeWebMcp />
        {children}
      </body>
    </html>
  );
}
