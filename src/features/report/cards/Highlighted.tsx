import type { ReactNode } from "react";
/** The learner's sentence with the span that holds the error underlined. */
export function Highlighted({
  text,
  span,
}: {
  text: string;
  span: string;
}): ReactNode {
  const at = span === "" ? -1 : text.indexOf(span);
  if (at === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-danger-soft px-0.5 text-ink underline decoration-danger decoration-wavy decoration-1 underline-offset-4">
        {span}
      </mark>
      {text.slice(at + span.length)}
    </>
  );
}
