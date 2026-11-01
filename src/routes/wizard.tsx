import { createFileRoute } from "@tanstack/react-router";
import { WizardFlow } from "@/components/wizard-flow";

export const Route = createFileRoute("/wizard")({
  head: () => ({ meta: [{ title: "Wizard — OpenIoTwx" }] }),
  component: WizardPage,
});

function WizardPage() {
  return <WizardFlow />;
}
