import { useState } from "react";
import { DisplayPageHeader } from "components/display_components";
import { addDays, agencyDate, mondayOf } from "utils/helper_functions/format";
import { RequestPanel } from "./RequestPanel";
import { WeekGrid } from "./WeekGrid";

export const ScheduleScreen = () => {
  const today = agencyDate(new Date());
  // Start on the week that holds tomorrow: that is where the story happens.
  const [monday, setMonday] = useState(mondayOf(addDays(today, 1)));

  return (
    <>
      <DisplayPageHeader title="Schedule" description="Your agency's visits. Ask the assistant for a change; nothing moves until you approve it." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 min-w-0 xl:order-1">
          <WeekGrid monday={monday} today={today} onWeekChange={(date) => setMonday(mondayOf(date))} />
        </div>
        <div className="order-1 xl:order-2">
          <div className="xl:sticky xl:top-20">
            <RequestPanel />
          </div>
        </div>
      </div>
    </>
  );
};
