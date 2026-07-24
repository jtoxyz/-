import fs from 'node:fs';
import zlib from 'node:zlib';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync(path, content, 'utf8');
}

function unpack(value) {
  return zlib.gunzipSync(Buffer.from(value, 'base64')).toString('utf8');
}

function mustReplace(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return text.replace(oldValue, newValue);
}

function mustReplaceRegex(text, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const count = text.match(new RegExp(pattern.source, flags))?.length ?? 0;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return text.replace(pattern, replacement);
}

const migration = unpack('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');
const adminNav = unpack('H4sIAMBbY2oC/+1XW28bRRR+z68Yoqi7FvZuKQWJNE4JERJIaalKxUvTKuPdsb1kPbPMzDqxXEu13aJeKK3oTSoVFQilkKqhFQhaWuC/MLk98hM4e/XasdtEFW/4Yb2z58yZb77vnDO7mi8IslyHUKkdGhtzah7jEs05dBGVOashjZJlabowBnNsbSKYdJz5kvB8cHsMyyrFNYJa2TkU150Klg6j2ZnC93AJi57vuxC8ZCaPAwxkOfS1SRn7rkRln1pBFDRj1xx6FNf1HGqOIWQxKiTiIQxU7EHSc4dSq5cgK2ZxZj0ccZwIwushUHEMVwJf8/S8iYPV5k1SB2bEvHnytHnq9XmTZ5wnTEMSIfVkEYiahq1iartkjlUAEgTEokEtBMCL0yF2hCRvxHcI4SXsyJQZA/uyaginQj/yZQQ1+EUbNTxfVHUtQme6rOJQLXZpIQtLq4p0kksjB2CYSwzCOeO6FuMJR5NaHpFkKlxbGfQVImeA8zrJcDPLXL9GP8GuTwTsSLfC8YfUJsuTiPq1EuG5SSQkd2jl5KneRhOZloJZM5zjhhEIr8cIbWb5NaDY+MwnvPExcYklGZ9x3akPThyZO4FLLsi69L5LAqdpXTOyChRkYC/YRCxK5iFZYnYDmNVyYfBID2COSJ/TEEK8qFF23CBTdHgWagL/hpANYIp52HJkA71WLCJtv3EwjgVzatjrnzAa8Sxx3R5kaWu5kxm6Th2GvFmWs4xKcIABd2qQGmfOIK23WozwPQbyYRrqlFXIYl5jhzi9RIuZ36FQPjSQmicbR4gQkO2JZJFF+JYFz+dwibiJBQy5QTnrSRq8LFOyaZLo4ZSRHgUwXEIrsoqKQPb+XtZil3CpZ1H2qiDUMsnaEZUUdx7GDWhsXolhbhtL3JHkBNCeLP0pc6iuzUP5pMGjdRcmmn3oWuvPflXttYlmlpyW6nylOj+p7qrqdlX3tureVd3nqntRtR+ozs+qeyMYtm+r9p/h9Z4621nYUahBHY4q1oXBBdtrmcAPNr5/vHnzdnaFyYV8VNkD+9FG4Hzy0oiAWdvRIeJqilJsynbqcHpgIY5CAyyOh22pAPyXMB+fjmFMBadJfI9QlZNycTxuYFF3HU+NvVDNhTRWITh90ESz18yD2uyLoKHDSMNhImpoEuqotdCKg06nwf+5d/08Wn/e3rrxbP3J2e2V+6r7bGvt261rnydAzQDprmGblCy9OvQgyq7g//3NTbR569H2ytV4D3/c3bxwba/QBZESilqYQvo2rF+IGsOr7GNEyF1q8uV1tPFwZevxla2bqxtXf9v+4eHG2p297qrkYmvRdYR8lX2kQXaJ/M4DpLq3VPfHoLSiGus8Vd0LQ8E3h7xo7NuH9DTeVC80DEq+lIxmnkCfa3hQYZFhvM8CLdd1rMViM3rBGHo26AfySMuU+33VvqI6lzfvXty49FS1V9d/v7D1y7nts+dV+wvVPhf2gK9V53rQA2Dm5qOrG9euaLlW38LDKj+kuB9feLIWm82+hwiVGLcJB34po0TLD1gtnwsWWD1o1HAU7nAogVoVeCuiNjjVMdcLBThsGC94cJ5i3ihUXDisd8YNfIbPGHRuZXc73WeCXnIZRaQEbbT9V0ptVkUzUus/VvbNFyubra5Q3I7qXBrUN+v0v8oju9NetJ4yk/uUz0HxU3mznwutsT0QP4T00YS/kOw+onmlhPUDBw/m0duQXe/A/37jjbf6mRtGsY1pBb4D+vyAc/hKmSNlCc7wbcMy1tbQvroKffWh6jxSne9UZyXbUbMcT5nw8hHcwitKa+xfkP1fp8gOAAA=');
const blacklistPage = unpack('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');

write('supabase/migrations/20260724000100_expired_tickets_and_blacklist.sql', migration);
write('src/components/AdminNav.tsx', adminNav);
write('src/app/admin/blacklist/page.tsx', blacklistPage);

// Remove duplicated event-level reservation window fields from create/edit pages.
for (const path of ['src/app/admin/events/new/page.tsx', 'src/app/admin/events/[id]/page.tsx']) {
  let text = read(path);

  text = mustReplace(
    text,
    `  // Date/Time strings (empty string represents null)
  const [reservationStartsAt, setReservationStartsAt] = useState('');
  const [reservationEndsAt, setReservationEndsAt] = useState('');
  const [useStartsAt, setUseStartsAt] = useState('');`,
    `  // Date/Time strings (empty string represents null)
  const [useStartsAt, setUseStartsAt] = useState('');`,
    `${path}: remove event-level reservation state`,
  );

  text = mustReplace(
    text,
    '      reservation_starts_at: reservationStartsAt ? new Date(reservationStartsAt).toISOString() : null,',
    '      reservation_starts_at: null,',
    `${path}: event reservation start payload`,
  );

  text = mustReplace(
    text,
    '      reservation_ends_at: reservationEndsAt ? new Date(reservationEndsAt).toISOString() : null,',
    '      reservation_ends_at: null,',
    `${path}: event reservation end payload`,
  );

  text = mustReplaceRegex(
    text,
    /\n\s*<div style=\{\{ display: 'grid', gridTemplateColumns: 'repeat\(auto-fit, minmax\(250px, 1fr\)\)', gap: '16px' \}\}>\s*<div className="form-group">\s*<label className="form-label" htmlFor="reservationStartsAt">予約受付開始日時<\/label>[\s\S]*?<\/div>\s*<\/div>\s*\n\s*\{\/\* Slot selection mode \*\/\}/,
    '\n\n            {/* Slot selection mode */}',
    `${path}: remove event-level reservation UI`,
  );

  if (path.includes('/[id]/')) {
    text = mustReplace(
      text,
      '        setReservationStartsAt(formatIsoToLocalString(data.reservation_starts_at));\n',
      '',
      `${path}: remove reservation start initializer`,
    );
    text = mustReplace(
      text,
      '        setReservationEndsAt(formatIsoToLocalString(data.reservation_ends_at));\n',
      '',
      `${path}: remove reservation end initializer`,
    );
    text = mustReplace(
      text,
      '            reservationStartsAt: formatIsoToLocalString(s.reservation_starts_at || data.reservation_starts_at),',
      '            reservationStartsAt: formatIsoToLocalString(s.reservation_starts_at),',
      `${path}: remove slot start fallback`,
    );
    text = mustReplace(
      text,
      '            reservationEndsAt: formatIsoToLocalString(s.reservation_ends_at || data.reservation_ends_at),',
      '            reservationEndsAt: formatIsoToLocalString(s.reservation_ends_at),',
      `${path}: remove slot end fallback`,
    );
  }

  write(path, text);
}

// Remove the event-level reservation period from the public event page.
{
  const path = 'src/app/events/[id]/page.tsx';
  let text = read(path);

  text = mustReplace(
    text,
    '  reservation_starts_at: string | null;\n  reservation_ends_at: string | null;\n',
    '',
    `${path}: remove event-level fields from interface`,
  );

  text = mustReplace(
    text,
    `
          <div className="info-label">受付期間</div>
          <div className="info-value">
            {event.reservation_starts_at ? formatDateTime(event.reservation_starts_at) : '制限なし'} 〜 <br />
            {event.reservation_ends_at ? formatDateTime(event.reservation_ends_at) : '制限なし'}
          </div>`,
    '',
    `${path}: remove event-level period display`,
  );

  write(path, text);
}

// Hide fully expired slots from the ticket finder. The RPC also refuses expired tickets.
{
  const path = 'src/app/tickets/find/page.tsx';
  let text = read(path);

  text = mustReplace(
    text,
    `interface EventSlot {
  id: string;
  label: string;
  starts_at: string | null;
}`,
    `interface EventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  ticket_use_ends_at: string | null;
  walkin_use_ends_at: string | null;
  walkin_ends_at: string | null;
}`,
    `${path}: extend slot interface`,
  );

  text = mustReplace(
    text,
    ".select('id, label, starts_at')",
    ".select('id, label, starts_at, ends_at, ticket_use_ends_at, walkin_use_ends_at, walkin_ends_at')",
    `${path}: fetch use end fields`,
  );

  text = mustReplace(
    text,
    `        const availableSlots = data ?? [];
        setSlots(availableSlots);`,
    `        const now = Date.now();
        const availableSlots = (data ?? []).filter((slot) => {
          const reservationEnd = slot.ticket_use_ends_at || slot.ends_at;
          const walkinEnd = slot.walkin_use_ends_at || slot.walkin_ends_at || slot.ticket_use_ends_at || slot.ends_at;
          const reservationStillVisible = !reservationEnd || new Date(reservationEnd).getTime() >= now;
          const walkinStillVisible = !walkinEnd || new Date(walkinEnd).getTime() >= now;
          return reservationStillVisible || walkinStillVisible;
        });
        setSlots(availableSlots);`,
    `${path}: filter expired slots`,
  );

  write(path, text);
}

console.log('Phase 1 repository changes applied.');
