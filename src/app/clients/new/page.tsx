import ClientForm from "../ClientForm";
import { saveClient } from "../actions";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">New client</h1>
      <ClientForm client={{}} action={saveClient} />
    </div>
  );
}
