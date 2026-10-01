import type { ReactNode } from "react";

export function Badge({
  cls,
  children,
}: {
  cls: string;
  children: ReactNode;
}) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function SectionTitle({
  eyebrow,
  title,
  extra,
}: {
  eyebrow: string;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {extra}
    </div>
  );
}
