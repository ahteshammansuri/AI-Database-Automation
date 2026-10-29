import React from "react";
import { Select2, SelectOption, Select2Props } from "../ui/Select2";

export type { SelectOption };
export type SearchableSelectProps = Select2Props;

/**
 * SearchableSelect is an alias for the Select2 component, ensuring backward
 * compatibility across existing pages and components.
 */
export const SearchableSelect: React.FC<Select2Props> = (props) => {
  return <Select2 {...props} />;
};

export { Select2 };
