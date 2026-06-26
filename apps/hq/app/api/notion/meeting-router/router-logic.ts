import { loadEnv } from '@lp-ai/lib-config';
import {
  getPage,
  getUserEmail,
  findPeopleByEmail,
  updatePageProperties,
  createPerson,
  type NotionPage,
} from './notion';
import { listEventsForUser, type CalendarEvent } from './google-calendar';

export type Track = 'Programs' | 'Inc. Clients';

// Routing exception set. A meeting routes to Programs when its ORGANIZER (the
// calendar "sender") matches one of these; everything else defaults to Inc. Clients.
const EXCEPTION_EMAILS = new Set(['nick@launchpadphilly.org', 'dannyelle@launchpadphilly.org']);
const EXCEPTION_DOMAINS = new Set(['b-21.org']);

// How far around the recording's timestamp to search for the calendar event.
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * The routing rule. Keyed on the meeting ORGANIZER's email (not attendees, not the
 * note's author): anything Christian/others create defaults to Inc. Clients; only
 * meetings sent by Nick, Dannyelle, or anyone @b-21.org go to Programs.
 */
export function routeTrack(organizerEmail: string | null): Track {
  if (!organizerEmail) return 'Inc. Clients';
  const email = organizerEmail.trim().toLowerCase();
  if (EXCEPTION_EMAILS.has(email)) return 'Programs';
  const domain = email.split('@')[1] ?? '';
  if (EXCEPTION_DOMAINS.has(domain)) return 'Programs';
  return 'Inc. Clients';
}

function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/** True when a page's parent is the configured Meetings database/data source. */
export async function pageBelongsToMeetingsDb(page: NotionPage): Promise<boolean> {
  const env = await loadEnv();
  const target = env.NOTION_MEETING_TRANSCRIPTS_DB_ID;
  if (!target) return false;
  const t = normalizeId(target);
  const { database_id, data_source_id } = page.parent;
  return (
    (database_id !== undefined && normalizeId(database_id) === t) ||
    (data_source_id !== undefined && normalizeId(data_source_id) === t)
  );
}

// Google sets `organizer` to the *calendar* an event lives on. For events on a
// shared/group/resource calendar that's not a person — fall back to `creator`
// (the human who made the event), which is the real "sender" for routing.
function isGroupCalendar(email: string | undefined): boolean {
  return !!email && (email.endsWith('@group.calendar.google.com') || email.endsWith('@resource.calendar.google.com'));
}

function pickOrganizerEmail(event: CalendarEvent): string | null {
  const organizer = event.organizer?.email;
  if (!organizer || isGroupCalendar(organizer)) return event.creator?.email ?? organizer ?? null;
  return organizer;
}

function eventTimeMs(event: CalendarEvent, which: 'start' | 'end'): number | null {
  const value = event[which]?.dateTime ?? event[which]?.date;
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Pick the event whose time range contains the recording timestamp; else the nearest start. */
function pickMatchingEvent(events: CalendarEvent[], tsMs: number): CalendarEvent | null {
  for (const event of events) {
    const start = eventTimeMs(event, 'start');
    const end = eventTimeMs(event, 'end');
    if (start !== null && end !== null && tsMs >= start && tsMs <= end) return event;
  }
  let best: CalendarEvent | null = null;
  let bestDelta = Infinity;
  for (const event of events) {
    const start = eventTimeMs(event, 'start');
    if (start === null) continue;
    const delta = Math.abs(start - tsMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = event;
    }
  }
  return best;
}

interface AttendeeInfo {
  email: string;
  displayName: string | null;
}

interface ResolvedMeeting {
  organizer: string | null;
  attendees: AttendeeInfo[];
  event: CalendarEvent | null;
}

/**
 * Match a meeting note to its calendar event and pull organizer + attendees.
 * Impersonates the user who recorded the note (note.created_by) to read THEIR
 * calendar, searching a window around the note's created_time.
 */
async function resolveMeeting(page: NotionPage): Promise<ResolvedMeeting> {
  const empty: ResolvedMeeting = { organizer: null, attendees: [], event: null };

  const recorderEmail = await getUserEmail(page.created_by.id);
  if (!recorderEmail) return empty;

  const tsMs = Date.parse(page.created_time);
  if (Number.isNaN(tsMs)) return empty;

  const events = await listEventsForUser(
    recorderEmail,
    new Date(tsMs - MATCH_WINDOW_MS).toISOString(),
    new Date(tsMs + MATCH_WINDOW_MS).toISOString(),
  );
  const event = pickMatchingEvent(events, tsMs);
  if (!event) return empty;

  const organizer = pickOrganizerEmail(event);
  const attendees: AttendeeInfo[] = (event.attendees ?? [])
    .filter((a): a is { email: string; displayName?: string } => typeof a.email === 'string' && !a.resource)
    .map((a) => ({ email: a.email.toLowerCase(), displayName: a.displayName ?? null }));

  return { organizer, attendees, event };
}

export interface RoutingResult {
  pageId: string;
  organizer: string | null;
  track: Track | null;
  attendeesLinked?: number;
  attendeesCreated?: number;
  applied: boolean;
  skipped?: string;
}

/** Derive a display name for a new People record from email + calendar displayName. */
function nameForNewPerson(attendee: AttendeeInfo): string {
  if (attendee.displayName) return attendee.displayName;
  // Fall back to the local part of the email, title-cased.
  const local = attendee.email.split('@')[0] ?? attendee.email;
  return local
    .replace(/[._-]/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || attendee.email;
}

/**
 * Core router step: a page just landed in (or changed within) the Meetings DB.
 * Confirm it belongs to us, resolve its calendar event, then write back:
 *   - Track (from organizer)
 *   - Attendees relation (matched People rows) + Attendee Emails (raw, lossless)
 *   - Calendar Event ID
 * If an attendee has no People record, one is auto-created (Type: Contact).
 * Visibility is intentionally left UNSET (see note below).
 */
export async function applyRouting(pageId: string): Promise<RoutingResult> {
  const page = await getPage(pageId);

  if (!(await pageBelongsToMeetingsDb(page))) {
    return { pageId, organizer: null, track: null, applied: false, skipped: 'not a Meetings DB page' };
  }

  const { organizer, attendees, event } = await resolveMeeting(page);
  const track = routeTrack(organizer);
  const attendeeEmails = attendees.map((a) => a.email);

  // Link attendees to People by email; auto-create a record for unknowns.
  const env = await loadEnv();
  const peopleDbId = env.NOTION_PEOPLE_DB_ID;
  const relationIds: string[] = [];
  let created = 0;
  if (peopleDbId) {
    for (const attendee of attendees) {
      const existing = await findPeopleByEmail(peopleDbId, attendee.email);
      if (existing.length > 0) {
        relationIds.push(...existing);
      } else {
        // Auto-create a People record for this unknown attendee.
        const name = nameForNewPerson(attendee);
        const domain = attendee.email.split('@')[1] ?? '';
        const type = domain === 'launchpadphilly.org' ? 'Staff'
          : domain === 'b-21.org' ? 'Staff'
          : 'Contact';
        const newId = await createPerson(peopleDbId, { name, email: attendee.email, type });
        relationIds.push(newId);
        created += 1;
      }
    }
  }
  const uniqueRelationIds = [...new Set(relationIds)];

  const properties: Record<string, unknown> = {
    Track: { select: { name: track } },
    'Attendee Emails': {
      rich_text: attendeeEmails.length ? [{ text: { content: attendeeEmails.join(', ') } }] : [],
    },
  };
  if (uniqueRelationIds.length > 0) {
    properties['Attendees'] = { relation: uniqueRelationIds.map((id) => ({ id })) };
  }
  if (event?.id) {
    properties['Calendar Event ID'] = { rich_text: [{ text: { content: event.id } }] };
  }
  // NOTE: Visibility is deliberately left UNSET. Meeting transcripts can be
  // sensitive, and the Notion→pgvector connector fail-closes (skips pages with no
  // Visibility), so a transcript isn't searchable until a human tags its visibility.
  // A default-visibility policy can be added here later if desired.

  await updatePageProperties(pageId, properties);
  return { pageId, organizer, track, attendeesLinked: uniqueRelationIds.length, attendeesCreated: created, applied: true };
}
