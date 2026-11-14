import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DisplayButton, DisplayError, DisplayLoading } from "components/display_components";
import { useCaregivers, useSchedule } from "utils/hooks/useShiftPilotQueries";
import { addDays, agencyDate, firstName, formatTime, dateLabel, shortDateLabel, weekDates } from "utils/helper_functions/format";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { Visit } from "utils/types";

// The week at a glance: one row per caregiver, one column per day (agency time).
// Open visits (nobody assigned yet) sit in their own row at the top, in amber.

const OPEN_ROW = "__open__";

const VisitChip = ({ visit, open }: { visit: Visit; open?: boolean }) => (
  <div
    className={`rounded-md border px-2 py-1 text-xs leading-tight ${
      open ? "border-waiting/40 bg-waiting-tint text-waiting" : visit.status === "completed" ? "border-line bg-paper text-ink-faint" : "border-brand/20 bg-brand-tint text-ink"
    }`}
    title={`${visit.code} · ${visit.clientName} · ${formatTime(visit.start)}–${formatTime(visit.end)} · ${visit.units} units · ${visit.caregiverName ?? "open"}`}
  >
    <span className="font-semibold">{formatTime(visit.start)}</span> {firstName(visit.clientName)} {visit.clientName.split(" ")[1]?.[0] ?? ""}.
  </div>
);

export const WeekGrid = ({ monday, onWeekChange, today }: { monday: string; onWeekChange: (monday: string) => void; today: string }) => {
  const days = weekDates(monday);
  // A little wider than the week, then filtered by the agency's own dates (time zones never cut a visit off).
  const from = `${addDays(monday, -1)}T00:00:00.000Z`;
  const to = `${addDays(monday, 8)}T12:00:00.000Z`;
  const { data: visits, isLoading, error, refetch } = useSchedule(from, to);
  const { data: caregivers } = useCaregivers();

  const cells = useMemo(() => {
    const map = new Map<string, Visit[]>();
    (visits ?? [])
      .filter((visit) => visit.status !== "cancelled" && days.includes(agencyDate(visit.start)))
      .forEach((visit) => {
        const key = `${visit.caregiverCode ?? OPEN_ROW}|${agencyDate(visit.start)}`;
        map.set(key, [...(map.get(key) ?? []), visit]);
      });
    return map;
  }, [visits, days]);

  const hoursFor = (code: string) =>
    (visits ?? [])
      .filter((v) => v.caregiverCode === code && v.status !== "cancelled" && days.includes(agencyDate(v.start)))
      .reduce((sum, v) => sum + (new Date(v.end).getTime() - new Date(v.start).getTime()) / 3_600_000, 0);

  const openCount = [...cells.entries()].filter(([key]) => key.startsWith(OPEN_ROW)).reduce((n, [, list]) => n + list.length, 0);
  const rows = [{ code: OPEN_ROW, name: "Open visits", maxHoursPerWeek: 0 }, ...(caregivers ?? [])];

  return (
    <section className="rounded-lg border border-line bg-sheet" aria-label="Week schedule">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-semibold">Week of {dateLabel(monday)}</h2>
          <p className="text-xs text-ink-faint">Times in Denver (agency) time · {openCount} open visit{openCount === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-1">
          <DisplayButton variant="ghost" onClick={() => onWeekChange(addDays(monday, -7))} aria-label="Previous week" icon={<ChevronLeft className="h-4 w-4" />} />
          <DisplayButton variant="secondary" onClick={() => onWeekChange(addDays(today, 0))}>This week</DisplayButton>
          <DisplayButton variant="ghost" onClick={() => onWeekChange(addDays(monday, 7))} aria-label="Next week" icon={<ChevronRight className="h-4 w-4" />} />
        </div>
      </div>

      {isLoading ? (
        <div className="px-4">
          <DisplayLoading label="Loading the week" />
        </div>
      ) : error ? (
        <div className="p-4">
          <DisplayError message={getErrorMessage(error)} onRetry={() => refetch()} />
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-sheet">
              <tr>
                <th className="w-44 border-b border-line px-3 py-2 text-left text-xs font-semibold text-ink-soft">Caregiver</th>
                {days.map((day) => (
                  <th key={day} className={`border-b border-line px-2 py-2 text-left text-xs font-semibold ${day === today ? "text-brand" : "text-ink-soft"}`}>
                    {shortDateLabel(day)}
                    {day === today && <span className="ml-1 font-normal">(today)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = row.code === OPEN_ROW;
                if (open && openCount === 0) return null;
                const hours = open ? 0 : hoursFor(row.code);
                return (
                  <tr key={row.code} className={open ? "bg-waiting-tint/40" : "even:bg-paper/50"}>
                    <th scope="row" className="border-b border-line px-3 py-2 text-left align-top font-normal">
                      <span className={`block font-medium ${open ? "text-waiting" : ""}`}>{row.name}</span>
                      {!open && (
                        <span className="text-xs text-ink-faint">
                          {Math.round(hours * 10) / 10} of {row.maxHoursPerWeek} h
                        </span>
                      )}
                    </th>
                    {days.map((day) => (
                      <td key={day} className="border-b border-line px-1.5 py-1.5 align-top">
                        <div className="flex flex-col gap-1">
                          {(cells.get(`${row.code}|${day}`) ?? []).map((visit) => (
                            <VisitChip key={visit.code} visit={visit} open={open} />
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
