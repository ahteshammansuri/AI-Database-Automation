import React, { useMemo } from "react";
import { Globe } from "lucide-react";
import { SearchableSelect } from "../common/SearchableSelect";
import { browserTimeZone, canonicalTimeZone, listTimeZones, tzOffsetLabel } from "../../lib/schedule";

interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
}

/** Searchable IANA timezone picker with current UTC offsets; the browser's zone is listed first. */
export const TimezoneSelect: React.FC<TimezoneSelectProps> = ({ value, onChange, id }) => {
  const options = useMemo(() => {
    const now = new Date();
    const local = browserTimeZone();
    const zones = listTimeZones();
    const ordered = [local, ...zones.filter((z) => z !== local)];
    return ordered.map((tz) => ({
      value: tz,
      label: `${tz.replace(/_/g, " ")}`,
      badge: tz === local ? `Your zone · ${tzOffsetLabel(tz, now)}` : tzOffsetLabel(tz, now),
      icon: <Globe className="w-3.5 h-3.5 text-slate-400" />,
    }));
  }, []);

  return (
    <SearchableSelect
      id={id}
      value={canonicalTimeZone(value)}
      onChange={(v) => onChange(String(v))}
      options={options}
      placeholder="Choose a timezone"
      searchPlaceholder="Search city or region (e.g. Kolkata, London)"
      showSearch
    />
  );
};
