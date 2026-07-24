from pathlib import Path

path = Path('src/app/admin/events/[id]/reservations/page.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
("""  created_at: string;
  event_slots: { label: string } | null;
""", """  created_at: string;
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  paid_at: string | null;
  event_slots: { label: string } | null;
"""),
("""  const [searchQuery, setSearchQuery] = useState('');
  const [showWipeModal, setShowWipeModal] = useState(false);
""", """  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'pending' | 'paid' | 'expired' | 'not_required'>('all');
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(null);
  const [showWipeModal, setShowWipeModal] = useState(false);
"""),
("""  const loadData = async () => {
    try {
      setError(null);
""", """  const loadData = async () => {
    try {
      setError(null);
      await supabase.rpc('admin_expire_unpaid_reservations');
"""),
("""  const handleWipeData = async () => {
""", """  const handleSetPaymentStatus = async (reservationId: string, paid: boolean) => {
    setUpdatingPaymentId(reservationId);
    setError(null);
    const { error: paymentError } = await supabase.rpc('admin_set_reservation_payment_status', {
      p_reservation_id: reservationId,
      p_paid: paid,
    });
    if (paymentError) setError(paymentError.message);
    else await loadData();
    setUpdatingPaymentId(null);
  };

  const handleWipeData = async () => {
"""),
("""  const filteredReservations = reservations.filter((res) => {
    const query = searchQuery.trim().toLowerCase();
    return !query || res.student_name.toLowerCase().includes(query) || res.student_number.toLowerCase().includes(query);
  });
""", """  const filteredReservations = reservations.filter((res) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery = !query || res.student_name.toLowerCase().includes(query) || res.student_number.toLowerCase().includes(query);
    const matchesPayment = paymentFilter === 'all' || res.payment_status === paymentFilter;
    return matchesQuery && matchesPayment;
  });
"""),
("""  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;
""", """  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;
  const pendingPayments = reservations.filter((r) => r.payment_status === 'pending').length;
  const paidPayments = reservations.filter((r) => r.payment_status === 'paid').length;
  const expiredPayments = reservations.filter((r) => r.payment_status === 'expired').length;
"""),
("""                <input className="form-input" placeholder="氏名・学籍番号で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <button onClick={handleExportCsv} className="btn btn-secondary">📥 CSV出力</button>
""", """                <input className="form-input" placeholder="氏名・学籍番号で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <select className="form-input" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}>
                  <option value="all">支払い：すべて</option>
                  <option value="pending">未払い</option>
                  <option value="paid">支払い済み</option>
                  <option value="expired">期限切れ</option>
                  <option value="not_required">支払い不要</option>
                </select>
                <button onClick={handleExportCsv} className="btn btn-secondary">📥 CSV出力</button>
"""),
("""              <div className="glass-card"><small>総記録件数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{reservations.length}</div><small>有効＋キャンセル</small></div>
""", """              <div className="glass-card"><small>総記録件数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{reservations.length}</div><small>有効＋キャンセル</small></div>
              <div className="glass-card"><small>未払い</small><div style={{ fontSize: 28, fontWeight: 700 }}>{pendingPayments}</div><small>期限内の未払い</small></div>
              <div className="glass-card"><small>支払い済み</small><div style={{ fontSize: 28, fontWeight: 700 }}>{paidPayments}</div><small>確認済み</small></div>
              <div className="glass-card"><small>期限切れ</small><div style={{ fontSize: 28, fontWeight: 700 }}>{expiredPayments}</div><small>自動キャンセル</small></div>
"""),
("""              <thead><tr><th>予約日時</th><th>券種</th><th>氏名</th><th>学籍番号</th><th>開催枠</th><th>大学メールアドレス</th><th>状態</th><th>操作</th></tr></thead>
""", """              <thead><tr><th>予約日時</th><th>券種</th><th>氏名</th><th>学籍番号</th><th>開催枠</th><th>大学メールアドレス</th><th>状態</th><th>支払い</th><th>操作</th></tr></thead>
"""),
("""                    <td>{res.status === 'reserved' ? '有効' : res.status === 'used' ? '使用済み' : 'キャンセル'}</td>
                    <td>{res.status !== 'cancelled' && <button className="btn btn-secondary btn-sm" onClick={() => handleCancelReservation(res.id)} disabled={cancellingId === res.id}>❌ 取消</button>}</td>
""", """                    <td>{res.status === 'reserved' ? '有効' : res.status === 'used' ? '使用済み' : 'キャンセル'}</td>
                    <td>
                      {res.payment_status === 'not_required' && '支払い不要'}
                      {res.payment_status === 'pending' && <><strong>未払い</strong><div style={{ fontSize: 12, marginTop: 4 }}>期限 {formatDateTime(res.payment_due_at)}</div></>}
                      {res.payment_status === 'paid' && <><strong>支払い済み</strong><div style={{ fontSize: 12, marginTop: 4 }}>{formatDateTime(res.paid_at)}</div></>}
                      {res.payment_status === 'expired' && <strong>期限切れ</strong>}
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {res.status !== 'cancelled' && res.payment_status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => handleSetPaymentStatus(res.id, true)} disabled={updatingPaymentId === res.id}>💴 支払い済みにする</button>}
                      {res.status !== 'cancelled' && res.payment_status === 'paid' && <button className="btn btn-secondary btn-sm" onClick={() => handleSetPaymentStatus(res.id, false)} disabled={updatingPaymentId === res.id}>未払いに戻す</button>}
                      {res.status !== 'cancelled' && <button className="btn btn-secondary btn-sm" onClick={() => handleCancelReservation(res.id)} disabled={cancellingId === res.id}>❌ 取消</button>}
                    </td>
"""),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'target snippet not found:\n{old[:120]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
