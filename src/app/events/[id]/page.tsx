export const runtime = 'edge';

import { redirect } from 'next/navigation';

export default async function LegacyEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/reserve/${id}`);
}
