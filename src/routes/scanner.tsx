import { createFileRoute } from "@tanstack/react-router";
import { UnifiedTerminal } from "@/components/UnifiedTerminal";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Universal Signal Matrix · MWASE HACKING BOT" },
      {
        name: "description",
        content:
          "Live digit studio and confluence scanner ranking every Deriv instrument and contract type. Estimates only, no guaranteed profits.",
      },
      { property: "og:title", content: "Universal Signal Matrix · MWASE HACKING BOT" },
      {
        property: "og:description",
        content: "Rank all Deriv instruments and contract types by confluence confidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <UnifiedTerminal matrix />,
});
