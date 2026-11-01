import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { ConfirmHost } from "@/components/confirm-dialog";
import { AuthProvider } from "@/lib/auth/provider";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { ChatWidget } from "@/components/chat-widget";
import { useDraft } from "@/lib/wizard/store";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OpenIoTwx | plan a station from the place" },
      {
        name: "description",
        content:
          "A needs-first wizard for OpenIoTwx. Leave with a station configuration and a draft community checklist.",
      },
      { name: "theme-color", content: "#071530" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg?v=2" },
      { rel: "shortcut icon", href: "/favicon.ico?v=2" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png?v=2" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: Root,
});

function Root() {
  const hydrate = useDraft((state) => state.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          <SiteHeader />
          <Outlet />
          <SiteFooter />
          <ChatWidget />
          <Toaster
            position="bottom-center"
            toastOptions={{
              classNames: {
                toast: "!rounded-2xl !border !border-line !bg-card !text-ink !shadow-xl !font-sans",
                description: "!text-muted",
                actionButton: "!rounded-full !bg-kelp !text-paper",
              },
            }}
          />
          <ConfirmHost />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
