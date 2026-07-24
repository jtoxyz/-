from pathlib import Path

FILES = [
    Path('src/app/admin/events/new/page.tsx'),
    Path('src/app/admin/events/[id]/page.tsx'),
]

PAYMENT_CARD = '''          {/* Section: Payment settings */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              支払い設定
            </h3>
            <label className="form-checkbox-label" style={{ marginBottom: '12px' }}>
              <input
                type="checkbox"
                className="form-checkbox"
                checked={paymentRequired}
                onChange={(e) => setPaymentRequired(e.target.checked)}
                disabled={saving}
              />
              この企画は支払い必須
            </label>
            <p className="form-hint" style={{ marginBottom: '16px' }}>
              OFFの場合は従来どおり予約直後から有効です。ONの場合は支払い済みになるまで未払いとして管理されます。
            </p>
            {paymentRequired && (
              <div className="form-group">
                <label className="form-label" htmlFor="paymentDeadlineMinutes">支払期限（予約から何分以内）</label>
                <input
                  id="paymentDeadlineMinutes"
                  type="number"
                  min="1"
                  step="1"
                  className="form-input"
                  value={paymentDeadlineMinutes}
                  onChange={(e) => setPaymentDeadlineMinutes(e.target.value)}
                  disabled={saving}
                  required
                />
                <span className="form-hint">期限を過ぎた未払い予約は自動キャンセルされ、枠が戻ります。</span>
              </div>
            )}
          </div>

'''

for path in FILES:
    text = path.read_text(encoding='utf-8')

    state_anchor = "  const [useButtonEnabled, setUseButtonEnabled] = useState(false);\n"
    state_insert = state_anchor + "  const [paymentRequired, setPaymentRequired] = useState(false);\n  const [paymentDeadlineMinutes, setPaymentDeadlineMinutes] = useState('30');\n"
    if 'const [paymentRequired' not in text:
        if text.count(state_anchor) != 1:
            raise SystemExit(f'{path}: state anchor count {text.count(state_anchor)}')
        text = text.replace(state_anchor, state_insert, 1)

    if path.name == 'page.tsx' and '[id]' in str(path):
        load_anchor = "        setUseButtonEnabled(data.use_button_enabled ?? false);\n"
        load_insert = load_anchor + "        setPaymentRequired(data.payment_required ?? false);\n        setPaymentDeadlineMinutes(String(data.payment_deadline_minutes ?? 30));\n"
        if 'setPaymentRequired(data.payment_required' not in text:
            if text.count(load_anchor) != 1:
                raise SystemExit(f'{path}: load anchor count {text.count(load_anchor)}')
            text = text.replace(load_anchor, load_insert, 1)

    validation_anchor = "    // Domain normalization\n"
    validation = """    if (paymentRequired) {
      const deadlineMinutes = Number(paymentDeadlineMinutes);
      if (!Number.isInteger(deadlineMinutes) || deadlineMinutes < 1) {
        setError('支払期限は1分以上の整数で入力してください。');
        setSaving(false);
        return;
      }
    }

""" + validation_anchor
    if "支払期限は1分以上" not in text:
        if text.count(validation_anchor) != 1:
            raise SystemExit(f'{path}: validation anchor count {text.count(validation_anchor)}')
        text = text.replace(validation_anchor, validation, 1)

    payload_anchor = "      use_button_enabled: useButtonEnabled,\n"
    payload_insert = payload_anchor + "      payment_required: paymentRequired,\n      payment_deadline_minutes: paymentRequired ? Number(paymentDeadlineMinutes) : 30,\n"
    if 'payment_required: paymentRequired' not in text:
        if text.count(payload_anchor) != 1:
            raise SystemExit(f'{path}: payload anchor count {text.count(payload_anchor)}')
        text = text.replace(payload_anchor, payload_insert, 1)

    form_anchor = "        <form onSubmit={handleSubmit}>\n"
    if 'Section: Payment settings' not in text:
        if text.count(form_anchor) != 1:
            raise SystemExit(f'{path}: form anchor count {text.count(form_anchor)}')
        text = text.replace(form_anchor, form_anchor + PAYMENT_CARD, 1)

    path.write_text(text, encoding='utf-8')
