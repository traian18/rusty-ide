import { Callout, Button } from "../components/ui";
import type { ForeignKind, ForeignSource } from "./model";
import { FOREIGN_NAME, foreignSummary } from "./pure";

/** Offers to bring an OpenSpec or Spec Kit folder into the specs. The source stays; nothing here is overwritten. */
export function ForeignBanner({ found, onImport }: { found: readonly ForeignSource[]; onImport(source: ForeignKind): void }) {
  if (!found.length) return null;
  return (
    <>
      {found.map((source) => (
        <Callout key={source.source} variant="info">
          {foreignSummary(source)}{" "}
          <Button variant="secondary" title="Copies it into the specs folder; the original stays where it is and nothing that exists here is overwritten" onClick={() => onImport(source.source)}>
            Import from {FOREIGN_NAME[source.source]}
          </Button>
        </Callout>
      ))}
    </>
  );
}
