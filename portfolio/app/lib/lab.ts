// The lab's experiments (content/lab.json).
import lab from "$content/lab.json";

export interface Experiment {
  slug: string;
  name: string;
  area: string;
  status: "exploring" | "shipped" | "paused";
  summary: string;
  notes?: string;
  /** Where to read more. */
  href?: string;
}
export default lab as Experiment[];
