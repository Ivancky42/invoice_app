import type { getKernel } from "@/lib/evolution/read";

type Props = {
  kernel: ReturnType<typeof getKernel>;
};

export function KernelFences({ kernel }: Props) {
  return (
    <section className="px-5 py-5">
      <h3 className="font-medium">Kernel fences</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">
        Pinned clauses — proposals that touch these are rejected and logged as{" "}
        <code className="text-[0.7rem]">KERNEL_ATTEMPT</code>.
      </p>
      <ul className="space-y-2">
        {kernel.clauses.map((c) => (
          <li key={c.id} className="text-sm border border-gray-100 rounded-md px-3 py-2">
            <div className="font-medium text-gray-900">{c.id}</div>
            <div className="text-xs text-gray-400 font-mono truncate">{c.sha256}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
