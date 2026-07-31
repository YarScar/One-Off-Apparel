import { prisma } from '@lp-ai/lib-db';
import { toggleToolRole } from './actions';
import { ROLES } from './roles';

const CATEGORY_LABELS: Record<string, string> = {
  students: 'Students',
  donor_finance: 'Donors & Finance',
  search: 'Cross-cutting search',
  skills: 'Skills',
  grants: 'Grant writing',
  future: 'Future / not yet implemented',
  other: 'Other',
};

// A category missing from this array is silently dropped from the matrix below, so any new
// tool_permissions category must be added here as well as to CATEGORY_LABELS.
const CATEGORY_ORDER = [
  'students',
  'donor_finance',
  'search',
  'skills',
  'grants',
  'future',
  'other',
];

interface ToolRow {
  toolName: string;
  category: string;
  description: string | null;
  allowedRoles: string[];
}

async function fetchToolPermissions(): Promise<ToolRow[]> {
  const rows = await prisma.toolPermission.findMany({
    orderBy: [{ category: 'asc' }, { toolName: 'asc' }],
  });
  return rows.map((r) => ({
    toolName: r.toolName,
    category: r.category,
    description: r.description,
    allowedRoles: r.allowedRoles,
  }));
}

export async function PermissionsMatrix() {
  const tools = await fetchToolPermissions();
  const byCategory = new Map<string, ToolRow[]>();
  for (const t of tools) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold">
              Tool
            </th>
            {ROLES.map((r) => (
              <th
                key={r}
                className="px-2 py-2 text-center font-mono font-semibold whitespace-nowrap"
                title={`Role: ${r}`}
              >
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
            <>
              <tr key={`hdr-${cat}`} className="bg-slate-100">
                <td
                  colSpan={ROLES.length + 1}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                >
                  {CATEGORY_LABELS[cat] ?? cat}
                </td>
              </tr>
              {byCategory.get(cat)!.map((t) => (
                <tr key={t.toolName} className="border-t hover:bg-slate-50">
                  <td className="sticky left-0 bg-white px-3 py-2 align-top">
                    <div className="font-mono font-medium">{t.toolName}</div>
                    {t.description && (
                      <div className="mt-0.5 text-[11px] text-muted">
                        {t.description}
                      </div>
                    )}
                  </td>
                  {ROLES.map((r) => {
                    const checked = t.allowedRoles.includes(r);
                    // `pending` and `admin` are special: pending should never be
                    // checked (it's the "no access" sentinel), admin should
                    // always have access. We still render the checkbox but
                    // make admin sticky-on visually and pending sticky-off.
                    const sticky =
                      r === 'admin' ? 'always' : r === 'pending' ? 'never' : null;
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        <form action={toggleToolRole} className="inline">
                          <input type="hidden" name="toolName" value={t.toolName} />
                          <input type="hidden" name="role" value={r} />
                          <input
                            type="hidden"
                            name="next"
                            value={checked ? 'false' : 'true'}
                          />
                          <button
                            type="submit"
                            title={
                              sticky === 'always'
                                ? 'admin always has access; toggling is allowed but not recommended'
                                : sticky === 'never'
                                  ? 'pending users by design cannot call any tool'
                                  : `${checked ? 'Remove' : 'Add'} ${r} from ${t.toolName}`
                            }
                            className={`h-5 w-5 rounded border ${
                              checked
                                ? 'border-green-500 bg-green-50 text-green-700'
                                : 'border-slate-300 bg-white text-slate-300'
                            } ${
                              sticky === 'always'
                                ? 'opacity-90'
                                : sticky === 'never'
                                  ? 'opacity-70'
                                  : ''
                            } hover:border-slate-500`}
                          >
                            {checked ? '✓' : ''}
                          </button>
                        </form>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
