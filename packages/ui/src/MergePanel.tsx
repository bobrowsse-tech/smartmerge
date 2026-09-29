import type { ReactElement } from "react";
import type { PanelModel } from "./model.js";

/** Presentational merge panel. It does not call git or decide a resolution. */
export function MergePanel({ model }: { model: PanelModel }): ReactElement {
  if (model.kind !== "conflict") {
    return (
      <section className="sm-panel" aria-label={model.title}>
        <h1 className="sm-title">{model.title}</h1>
        {"message" in model ? <p className="sm-muted">{model.message}</p> : null}
      </section>
    );
  }
  const { view } = model;
  return (
    <section className="sm-panel" aria-label={view.title}>
      <header className="sm-header">
        <h1 className="sm-title">{view.title}</h1>
        <p>{view.headline}</p>
        <p className="sm-summary" role="status" aria-label={view.summary}>
          {view.summary}
        </p>
      </header>
      <div className="sm-intent sm-sides">
        <article className="sm-card sm-current">
          <h2>{view.currentLabel}</h2>
          <p className="sm-muted">{view.currentSubject}</p>
          <pre>{view.currentText}</pre>
        </article>
        <article className="sm-card sm-base">
          <h2>Base</h2>
          <pre>{view.baseText}</pre>
        </article>
        <article className="sm-card sm-incoming">
          <h2>{view.incomingLabel}</h2>
          <p className="sm-muted">{view.incomingSubject}</p>
          <pre>{view.incomingText}</pre>
        </article>
      </div>
      <div className="sm-result">
        <h2 className="sm-title">Result</h2>
        <pre>{view.result}</pre>
        <div className="sm-notes">
          {view.notes.map((note) => (
            <p key={note} className={view.hazardous ? "sm-danger" : "sm-muted"}>
              {note}
            </p>
          ))}
        </div>
      </div>
      <div className="sm-actions">
        {view.acceptCandidateId ? (
          <button
            type="button"
            className="sm-primary"
            data-action="accept"
            data-path={view.path}
            data-hunk={view.hunkId}
            data-candidate={view.acceptCandidateId}
          >
            {view.acceptLabel}
          </button>
        ) : null}
        <button type="button" data-action="undo">
          Undo
        </button>
        {view.alternatives.map((alternative) => (
          <button
            key={alternative.id}
            type="button"
            data-action="alternative"
            data-path={view.path}
            data-hunk={view.hunkId}
            data-candidate={alternative.id}
          >
            {alternative.label}
          </button>
        ))}
      </div>
    </section>
  );
}
