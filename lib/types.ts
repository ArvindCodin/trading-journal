export type SourceType = "video" | "article";

export interface AiSummary {
  tldr: string;
  points: string[];
  takeaways: string[];
  watchOuts: string[];
  model: string;
  at: number;
}

export interface Source {
  id: string;
  url: string;
  title: string;
  type: SourceType;
  /** The person's own version of what this source taught them. */
  note: string;
  ai?: AiSummary;
}

export interface Takeaway {
  id: string;
  text: string;
  star: boolean;
}

export interface Recap {
  summary: string;
  gaps: string[];
  questions: string[];
  at: number;
}

export interface Entry {
  /** YYYY-MM-DD, local to the person writing. Also the database _id. */
  date: string;
  sources: Source[];
  learned: string;
  takeaways: Takeaway[];
  tags: string[];
  recap?: Recap;
  updatedAt: number;
}
