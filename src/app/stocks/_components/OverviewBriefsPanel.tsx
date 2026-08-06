"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { DailyLogDTO, StockReportDTO } from "@/lib/stocks/db";
import { DailyLogReader } from "@/app/stocks/_components/DailyLogReader";
import { StockReportReader } from "@/app/stocks/_components/StockReportReader";

type BriefKind = "daily" | "weekly" | "monthly";

function BriefBadge({ tone }: { tone: BriefKind }) {
	const cls =
		tone === "daily"
			? "bg-gray-100 text-gray-700"
			: tone === "weekly"
				? "bg-blue-50 text-blue-800 border border-blue-100"
				: "bg-violet-50 text-violet-800 border border-violet-100";
	const label = tone === "daily" ? "Daily" : tone === "weekly" ? "Weekly" : "Monthly";
	return (
		<span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
			{label}
		</span>
	);
}

function BriefRow({
	label,
	badge,
	subtitle,
	linkHref,
	linkLabel,
	onOpen,
}: {
	label: string;
	badge: BriefKind;
	subtitle: string;
	linkHref: string;
	linkLabel: string;
	onOpen: () => void;
}) {
	return (
		<div className="border-b border-gray-100 last:border-b-0">
			<div className="px-5 py-3 flex items-start justify-between gap-4 bg-white hover:bg-gray-50/50 transition">
				<button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left group">
					<div className="flex flex-wrap items-center gap-2 mb-1">
						<BriefBadge tone={badge} />
						<span className="font-medium text-gray-900 group-hover:underline">{label}</span>
					</div>
					<p className="text-sm text-gray-500 truncate group-hover:text-gray-700 transition">{subtitle}</p>
				</button>
				<div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
					<button
						type="button"
						onClick={onOpen}
						className="text-xs font-medium text-gray-900 hover:underline"
					>
						View
					</button>
					<Link
						href={linkHref}
						className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline whitespace-nowrap"
					>
						{linkLabel}
					</Link>
				</div>
			</div>
		</div>
	);
}

function BriefModal({
	title,
	subtitle,
	onClose,
	children,
}: {
	title: string;
	subtitle: string;
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10 bg-black/40"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<div
				className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[min(92vh,960px)] flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 shrink-0">
					<div className="min-w-0 pr-2">
						<h3 className="font-semibold text-gray-900 leading-snug">{title}</h3>
						<p className="text-sm text-gray-500 mt-1 truncate">{subtitle}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-sm font-medium text-gray-500 hover:text-gray-900 shrink-0 px-1 py-0.5"
						aria-label="Close"
					>
						Close ✕
					</button>
				</div>
				<div className="overflow-y-auto overscroll-contain px-6 py-5 sm:px-8 sm:py-6">{children}</div>
			</div>
		</div>
	);
}

export function OverviewBriefsPanel({
	daily,
	weekly,
	monthly,
}: {
	daily: DailyLogDTO | null;
	weekly: StockReportDTO | null;
	monthly: StockReportDTO | null;
}) {
	const [open, setOpen] = useState<BriefKind | null>(null);

	if (!daily && !weekly && !monthly) return null;

	const modalConfig =
		open === "daily" && daily
			? { title: "Daily brief", subtitle: daily.title, content: <DailyLogReader entry={daily} embedded /> }
			: open === "weekly" && weekly
				? {
						title: "Weekly report",
						subtitle: weekly.title,
						content: <StockReportReader entry={weekly} embedded />,
					}
				: open === "monthly" && monthly
					? {
							title: "Monthly report",
							subtitle: monthly.title,
							content: <StockReportReader entry={monthly} embedded />,
						}
					: null;

	return (
		<>
			<section className="card overflow-hidden">
				<div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
					<h2 className="font-medium">Latest briefs</h2>
					<p className="text-xs text-gray-500 mt-0.5">
						Daily scan plus the newest weekly and monthly reports.
					</p>
				</div>

				{daily ? (
					<BriefRow
						label="Daily brief"
						badge="daily"
						subtitle={daily.title}
						linkHref="/stocks/daily-log"
						linkLabel="All logs →"
						onOpen={() => setOpen("daily")}
					/>
				) : null}

				{weekly ? (
					<BriefRow
						label="Weekly report"
						badge="weekly"
						subtitle={weekly.title}
						linkHref="/stocks/reports"
						linkLabel="All reports →"
						onOpen={() => setOpen("weekly")}
					/>
				) : null}

				{monthly ? (
					<BriefRow
						label="Monthly report"
						badge="monthly"
						subtitle={monthly.title}
						linkHref="/stocks/reports"
						linkLabel="All reports →"
						onOpen={() => setOpen("monthly")}
					/>
				) : null}
			</section>

			{modalConfig ? (
				<BriefModal
					title={modalConfig.title}
					subtitle={modalConfig.subtitle}
					onClose={() => setOpen(null)}
				>
					{modalConfig.content}
				</BriefModal>
			) : null}
		</>
	);
}
