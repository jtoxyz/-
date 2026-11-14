import { redirect } from 'next/navigation';

// 「チケットを探す」はログインで本人の予約が分かるようになったため廃止した(2026-11-14)。
// 古いブックマークやQRから来た人は、自分の予約一覧へ送る。
export default function FindTicketPage() {
  redirect('/#my-tickets');
}
