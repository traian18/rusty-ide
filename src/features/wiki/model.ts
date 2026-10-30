/** A line range of a file, read at a content hash; checkable against the file's current hash. */
export interface Citation {
  file: string;
  start_line: number;
  end_line: number;
  content_hash: string;
}
