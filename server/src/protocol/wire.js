const EOF_MARKER = '<EOF>';

export function encodeMessage(type, payload, id) {
  return Buffer.from(`${type}|${JSON.stringify(payload)}|${id}|${EOF_MARKER}`, 'ascii');
}

// Splits on the first and last '|', so the JSON body must not contain a literal '|'
// (holds: string payloads are base64 or plain config JSON; bulk bytes use another channel).
export function decodeMessage(raw) {
  const body = raw.endsWith(EOF_MARKER) ? raw.slice(0, -EOF_MARKER.length) : raw;
  const first = body.indexOf('|');
  const trimmed = body.endsWith('|') ? body.slice(0, -1) : body;
  const last = trimmed.lastIndexOf('|');
  if (first < 0 || last <= first) throw new Error('Malformed wire message');
  return {
    type: trimmed.slice(0, first),
    payload: JSON.parse(trimmed.slice(first + 1, last)),
    id: parseInt(trimmed.slice(last + 1), 10),
  };
}
