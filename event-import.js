function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, row) => [row]);
  for (let col = 0; col <= a.length; col += 1) matrix[0][col] = col;

  for (let row = 1; row <= b.length; row += 1) {
    for (let col = 1; col <= a.length; col += 1) {
      const cost = a[col - 1] === b[row - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

function similarityScore(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const distance = levenshteinDistance(left, right);
  const maxLength = Math.max(left.length, right.length, 1);
  return 1 - distance / maxLength;
}

function resolveRelativeDate(relativeText, now = new Date()) {
  if (!relativeText) return null;

  const trimmed = String(relativeText).trim();
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime()) && trimmed.includes('T')) {
    return new Date(iso.getTime());
  }

  const normalized = normalizeText(trimmed);
  if (!normalized) return null;

  const weekdays = new Map([
    ['montag', 1], ['dienstag', 2], ['mittwoch', 3], ['donnerstag', 4], ['freitag', 5], ['samstag', 6], ['sonntag', 0]
  ]);

  const current = new Date(now);
  const base = new Date(current.getFullYear(), current.getMonth(), current.getDate());

  if (normalized.includes('heute')) return new Date(base.getTime());
  if (normalized.includes('morgen')) {
    const date = new Date(base.getTime());
    date.setDate(date.getDate() + 1);
    return date;
  }

  const weekdayMatch = [...weekdays.entries()].find(([label]) => normalized.includes(label));
  if (weekdayMatch) {
    const targetDay = weekdayMatch[1];
    const currentDay = base.getDay();
    const rawDiff = (targetDay - currentDay + 7) % 7;

    let diff = rawDiff;
    if (normalized.includes('letzten') || normalized.includes('vorletzten')) {
      diff = rawDiff === 0 ? -7 : rawDiff - 7;
    } else if (normalized.includes('nachsten') || normalized.includes('kommenden') || normalized.includes('diesem')) {
      diff = rawDiff === 0 ? 7 : rawDiff;
    } else if (diff === 0) {
      diff = 7;
    }

    const date = new Date(base.getTime());
    date.setDate(base.getDate() + diff);
    return date;
  }

  if (normalized.includes('diese woche')) {
    const date = new Date(base.getTime());
    date.setDate(date.getDate() + 2);
    return date;
  }

  const explicitDate = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (explicitDate) {
    const [, day, month, year] = explicitDate;
    return new Date(Number(year.length === 2 ? 2000 + Number(year) : year), Number(month) - 1, Number(day));
  }

  return null;
}

function buildContentHash(eventLike) {
  const payload = {
    title: eventLike.title || '',
    start_datetime: eventLike.start_datetime || eventLike.startDate || '',
    location_name: eventLike.location_name || eventLike.venue || '',
    address: eventLike.address || '',
    description: eventLike.description || '',
    price: eventLike.price || ''
  };
  return JSON.stringify(payload);
}

function eventMatchKey(eventLike = {}) {
  const start = eventLike.start_datetime || eventLike.startDate || '';
  const title = normalizeText(eventLike.title || '');
  const place = normalizeText(eventLike.location_name || eventLike.venue || eventLike.city || '');
  const date = start ? new Date(start).toISOString().slice(0, 10) : 'no-date';
  return `${title}|${place}|${date}`;
}

function detectDuplicate(existingEvent, candidateEvent) {
  const existingKey = eventMatchKey(existingEvent);
  const candidateKey = eventMatchKey(candidateEvent);

  if (existingKey === candidateKey) return true;

  const titleSimilarity = similarityScore(existingEvent.title, candidateEvent.title);
  const locationSimilarity = similarityScore(existingEvent.location_name || existingEvent.venue || '', candidateEvent.location_name || candidateEvent.venue || '');
  const dateMatch = (() => {
    const existingDate = existingEvent.start_datetime ? new Date(existingEvent.start_datetime).toISOString().slice(0, 10) : null;
    const candidateDate = candidateEvent.start_datetime ? new Date(candidateEvent.start_datetime).toISOString().slice(0, 10) : null;
    if (!existingDate || !candidateDate) return false;
    return existingDate === candidateDate;
  })();

  if (titleSimilarity >= 0.7 && dateMatch) return true;
  return titleSimilarity >= 0.7 && locationSimilarity >= 0.55 && dateMatch;
}

function archivePastEvents(events, now = new Date()) {
  const archived = [];
  const remaining = [];

  for (const event of events) {
    const end = event.end_datetime || event.start_datetime;
    const eventDate = end ? new Date(end) : null;
    if (eventDate && eventDate < now) {
      archived.push({ ...event, archived_at: new Date().toISOString(), archive_reason: 'past_event' });
    } else {
      remaining.push(event);
    }
  }

  return { archived, remaining };
}

module.exports = {
  normalizeText,
  levenshteinDistance,
  similarityScore,
  resolveRelativeDate,
  buildContentHash,
  eventMatchKey,
  detectDuplicate,
  archivePastEvents,
};
