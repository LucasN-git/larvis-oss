import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { contactName, upcomingBirthday, type Contact } from '@larvis/shared';
import { db } from '../supabase.js';
import { guard, ok, unwrap } from '../util.js';

const COLS =
  'id,first_name,last_name,nickname,birthday,birthday_year_known,business,phones,emails,addresses,company,position,current_status,linkedin_url,links,tags,notes_md,source,created_at,updated_at,deleted_at';

// Slim list shape: full jsonb fields only via get_contact, keeps list results small.
function toListRow(c: Contact) {
  const bd = upcomingBirthday(c);
  return {
    id: c.id,
    name: contactName(c),
    nickname: c.nickname,
    birthday: c.birthday,
    days_until_birthday: bd?.daysUntil ?? null,
    business: c.business,
    company: c.company,
    position: c.position,
    current_status: c.current_status || null,
    linkedin_url: c.linkedin_url,
    tags: c.tags,
    source: c.source,
  };
}

const handle = z.object({ label: z.string(), value: z.string() });
const link = z.object({ label: z.string(), url: z.string() });

export function registerContactTools(server: McpServer) {
  server.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description:
        'List address-book contacts (slim rows; full detail via get_contact). q matches name/nickname/company. business: true = only business contacts, false = only private ones, omit = all. upcoming_birthdays: true returns only contacts with a birthday, sorted by days until it. Soft-deleted contacts are hidden unless include_deleted.',
      inputSchema: {
        q: z.string().optional(),
        tag: z.string().optional(),
        business: z.boolean().optional(),
        upcoming_birthdays: z.boolean().optional(),
        include_deleted: z.boolean().optional(),
      },
    },
    async ({ q, tag, business, upcoming_birthdays, include_deleted }) =>
      guard(async () => {
        let query = db.from('contacts').select(COLS);
        if (!include_deleted) query = query.is('deleted_at', null);
        if (business !== undefined) query = query.eq('business', business);
        if (q) {
          const like = `%${q}%`;
          query = query.or(
            `first_name.ilike.${like},last_name.ilike.${like},nickname.ilike.${like},company.ilike.${like}`,
          );
        }
        if (tag) query = query.contains('tags', [tag]);
        if (upcoming_birthdays) query = query.not('birthday', 'is', null);
        const rows = unwrap(await query.order('first_name').order('last_name')) as unknown as Contact[];
        const list = rows.map(toListRow);
        if (upcoming_birthdays) list.sort((a, b) => (a.days_until_birthday ?? 999) - (b.days_until_birthday ?? 999));
        return ok(list);
      }),
  );

  server.registerTool(
    'get_contact',
    {
      title: 'Get contact',
      description: 'Fetch one contact with all fields (phones, emails, addresses, links, notes_md) by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => guard(async () => ok(unwrap(await db.from('contacts').select(COLS).eq('id', id).single()))),
  );

  server.registerTool(
    'upsert_contact',
    {
      title: 'Upsert contact',
      description:
        'Create or update a contact. Update via id; without id, a matching linkedin_url updates that contact instead of creating a duplicate. business: true = business contact, false = private (default). birthday is YYYY-MM-DD; if the year is unknown use 1604 and birthday_year_known=false. phones/emails/addresses are [{label,value}], links [{label,url}]. notes_md is the free-text note on the person.',
      inputSchema: {
        id: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        nickname: z.string().nullable().optional(),
        birthday: z.string().nullable().optional(),
        birthday_year_known: z.boolean().optional(),
        business: z.boolean().optional(),
        phones: z.array(handle).optional(),
        emails: z.array(handle).optional(),
        addresses: z.array(handle).optional(),
        company: z.string().nullable().optional(),
        position: z.string().nullable().optional(),
        current_status: z.string().optional(),
        linkedin_url: z.string().nullable().optional(),
        links: z.array(link).optional(),
        tags: z.array(z.string()).optional(),
        notes_md: z.string().optional(),
        source: z.enum(['manual', 'vcard', 'linkedin', 'whatsapp']).optional(),
      },
    },
    async ({ id, ...fields }) =>
      guard(async () => {
        let targetId = id ?? null;
        if (!targetId && fields.linkedin_url) {
          const { data } = await db.from('contacts').select('id').eq('linkedin_url', fields.linkedin_url).maybeSingle();
          targetId = data?.id ?? null;
        }
        const row = targetId
          ? unwrap(await db.from('contacts').update(fields).eq('id', targetId).select(COLS).single())
          : unwrap(await db.from('contacts').insert(fields).select(COLS).single());
        return ok(row);
      }),
  );

  server.registerTool(
    'delete_contact',
    {
      title: 'Delete contact',
      description: 'Soft-delete a contact (recoverable via restore_contact).',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('id', id));
        return ok({ deleted: id });
      }),
  );

  server.registerTool(
    'restore_contact',
    {
      title: 'Restore contact',
      description: 'Undo a soft-delete: bring a deleted contact back.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      guard(async () => {
        unwrap(await db.from('contacts').update({ deleted_at: null }).eq('id', id));
        return ok({ restored: id });
      }),
  );
}
