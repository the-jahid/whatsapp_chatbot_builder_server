const TOOL_DEBUG = process.env.TOOL_DEBUG === '1';

export function parseToolInput(raw: string | undefined): any {
    if (!raw) return {};
    const trimmed = raw.trim();

    // 1. Try pure JSON
    try {
        return JSON.parse(trimmed);
    } catch (_e) {
        // OK
    }

    // 2. Try fixing partial JSON keys
    try {
        const fixed = trimmed
            .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
            .replace(/'([^']*)'/g, '"$1"');
        return JSON.parse(fixed);
    } catch (_e) {
        // OK
    }

    // 3. Last resort: Heuristic extraction from natural language
    const result: any = {};

    // Look for full ISO timestamps first
    const isoTimeMatches = trimmed.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g);
    if (isoTimeMatches && isoTimeMatches.length >= 2) {
        result.startUtc = isoTimeMatches[0];
        result.endUtc = isoTimeMatches[1];
    } else {
        // Look for partial components (YYYY-MM-DD + HH:MM) ... (same as before)
        const dateMatch = trimmed.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) result.day = dateMatch[0];

        // Times: HH:MM
        const timeMatches = trimmed.match(/(\d{1,2}:\d{2})/g);
        if (result.day && timeMatches && timeMatches.length >= 2) {
            result.startUtc = `${result.day}T${timeMatches[0]}:00`;
            result.endUtc = `${result.day}T${timeMatches[1]}:00`;
        }
    }

    // Look for email
    const emailMatch = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
        result.email = emailMatch[0];
    }

    // Look for Name (heuristically, e.g. "Name: Jahid")
    const nameMatch = trimmed.match(/(?:Name|name)\s*[:]\s*([A-Za-z ]+)/);
    if (nameMatch) {
        result.name = nameMatch[1].trim();
    }

    // Look for Note
    const noteMatch = trimmed.match(/(?:Note|note)\s*[:]\s*(.+)/);
    if (noteMatch) {
        result.notes = noteMatch[1].trim();
    }

    if (Object.keys(result).length > 0) {
        if (TOOL_DEBUG) console.warn('[tool-input] Recovered params from natural language:', JSON.stringify(result));
        return result;
    }

    if (TOOL_DEBUG) console.warn('[tool-input] Failed to parse JSON, received raw text:', trimmed);
    throw new Error('INVALID_JSON_INPUT');
}

export function renderEventDescription(baseNotes?: string, answers?: Record<string, string>) {
    const lines: string[] = [];
    if (baseNotes) lines.push(baseNotes);
    if (answers && Object.keys(answers).length) {
        lines.push('', '--- Appointment Details ---');
        for (const [k, v] of Object.entries(answers)) lines.push(`${k}: ${v}`);
    }
    return lines.join('\n');
}

export function extractEmail(text: string): string | null {
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
}
