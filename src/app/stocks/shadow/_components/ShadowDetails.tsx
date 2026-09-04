import { listDecisionReviews } from "@/lib/agent/writes";
import { getKernel, listRuleVersions } from "@/lib/evolution/read";
import { getShadowFitness, listCounterfactuals } from "@/lib/fitness/read";
import { listShadowOrders } from "@/lib/shadow/read";
import type { ShadowRejectedTrade } from "@/lib/shadow/summary";
import { CounterfactualsTable } from "./CounterfactualsTable";
import { DecisionReviewsTable } from "./DecisionReviewsTable";
import { FitnessSnapshotsTable } from "./FitnessSnapshotsTable";
import { KernelFences } from "./KernelFences";
import { PaperOrdersTable } from "./PaperOrdersTable";
import { RejectedOrders } from "./RejectedOrders";
import { RuleVersionHistory } from "./RuleVersionHistory";

type Props = {
  liveLabel: string;
  candidateLabel: string;
  rejectedTrades: ShadowRejectedTrade[];
};

/** Existing technical tables — fetched here so the status page can stream first. */
export async function ShadowDetails({ liveLabel, candidateLabel, rejectedTrades }: Props) {
  const [
    liveOrders,
    candOrders,
    liveCf,
    candCf,
    liveFit,
    candFit,
    liveDecisions,
    candDecisions,
    versions,
  ] = await Promise.all([
    listShadowOrders({ branch: "LIVE", limit: 40 }),
    listShadowOrders({ branch: "CANDIDATE", limit: 40 }),
    listCounterfactuals({ branch: "LIVE", limit: 40 }),
    listCounterfactuals({ branch: "CANDIDATE", limit: 40 }),
    getShadowFitness({ branch: "LIVE", limit: 60 }),
    getShadowFitness({ branch: "CANDIDATE", limit: 60 }),
    listDecisionReviews({ branch: "LIVE", book: "PAPER", limit: 200 }),
    listDecisionReviews({ branch: "CANDIDATE", book: "PAPER", limit: 200 }),
    listRuleVersions({ limit: 100 }),
  ]);
  const kernel = getKernel();

  const tag = <T,>(rows: T[], bookLabel: string) => rows.map((r) => ({ ...r, bookLabel }));

  const orders = [
    ...tag(liveOrders.orders, liveLabel),
    ...tag(candOrders.orders, candidateLabel),
  ].sort((a, b) => (b.decisionSession ?? "").localeCompare(a.decisionSession ?? ""));

  const counterfactuals = [
    ...tag(liveCf.counterfactuals, liveLabel),
    ...tag(candCf.counterfactuals, candidateLabel),
  ].sort((a, b) => (b.decisionSession ?? "").localeCompare(a.decisionSession ?? ""));

  const snapshots = [
    ...tag(liveFit.snapshots, liveLabel),
    ...tag(candFit.snapshots, candidateLabel),
  ].sort((a, b) => (b.session ?? "").localeCompare(a.session ?? ""));

  const decisions = [
    ...tag(liveDecisions, liveLabel),
    ...tag(candDecisions, candidateLabel),
  ].sort((a, b) => (b.decisionDate ?? "").localeCompare(a.decisionDate ?? ""));

  return (
    <div className="divide-y">
      <PaperOrdersTable orders={orders} />
      <CounterfactualsTable counterfactuals={counterfactuals} />
      <FitnessSnapshotsTable snapshots={snapshots} />
      <DecisionReviewsTable decisions={decisions} />
      <RuleVersionHistory versions={versions.ruleVersions} />
      <KernelFences kernel={kernel} />
      <RejectedOrders orders={rejectedTrades} />
    </div>
  );
}
