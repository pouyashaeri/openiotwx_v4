import { createFileRoute } from "@tanstack/react-router";
import { PlanView } from "@/components/plan-view";

export const Route = createFileRoute("/plan")({
  head: () => ({ meta: [{ title: "Draft plan — OpenIoTwx" }] }),
  component: PlanPage,
});

function PlanPage() {
  return <PlanView />;
}
